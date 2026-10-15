import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import io.kestra.webserver.rbac.*;
import io.kestra.webserver.controllers.api.ExecutionController;
import io.kestra.webserver.errors.*;
import io.kestra.core.models.QueryFilter;
import io.kestra.core.models.flows.Flow;
import io.kestra.core.repositories.AuthorizationInvocationContext;
import io.kestra.mcp.KestraMcpTransportContext;
import io.kestra.webserver.mcp.McpCapabilityGate;
import io.micronaut.context.BeanProvider;
import io.micronaut.http.*;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.security.filters.SecurityFilter;
import io.micronaut.web.router.*;
import reactor.core.publisher.Mono;
import static io.kestra.webserver.rbac.TypedAuthorization.*;

/** Host-owned investigation only. Uses released host bytecode, no real plugin or replacement gates. */
public class EvaluationProbe {
    static final Authentication AUTH = Authentication.build("evaluation-probe", List.of());
    static final RbacConfiguration CONFIG = new RbacConfiguration(true, false);
    static int mixed;
    static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static <T> BeanProvider<T> bean(T value) {
        return new BeanProvider<>() {
            public T get() { return value; }
            public boolean isUnique() { return value != null; }
            public boolean isPresent() { return value != null; }
        };
    }
    static String key(Operation o) {
        return o.resource()+":"+o.action()+":"+o.namespace();
    }
    static class Policy implements TypedAuthorizationResolver {
        final String name;
        final Set<String> a, b;
        final int switchAfter;
        final boolean pinned;
        int revision, calls;
        final List<String> trace = new ArrayList<>();
        Policy(String name, Set<String> a, Set<String> b, int switchAfter, int revision, boolean pinned) {
            this.name=name; this.a=Set.copyOf(a); this.b=Set.copyOf(b);
            this.switchAfter=switchAfter; this.revision=revision; this.pinned=pinned;
        }
        public synchronized CompletionStage<Decision> authorize(RbacAuthorizer.Principal p, Operation o) {
            int readRevision=revision;
            boolean allowed=(readRevision==0 ? a : b).contains(key(o));
            QueryDomain domain=o.namespace()==null
                ? new QueryDomain(List.of(readRevision==0 ? "team.a" : "team.b"),List.of(),List.of(),true,false)
                : QueryDomain.unrestricted();
            trace.add("v"+(readRevision+1)+" "+o.source()+" "+key(o)+"="+allowed);
            if (++calls==switchAfter && !pinned) revision=1;
            return CompletableFuture.completedFuture(allowed ? Decision.allow(domain) : Decision.deny("probe policy"));
        }
        void report(String result) { System.out.println(name+" "+result+" trace="+trace); }
    }
    static TypedAuthorizationGate typed(Policy p) { return new TypedAuthorizationGate(bean(p)); }
    static RbacGate gate(Policy p) { return new RbacGate(bean(null),typed(p),true); }
    static MutableHttpRequest<?> request(String handler, byte[] body) {
        var request=HttpRequest.POST("/api/v1/main/executions/latest",body).contentType(MediaType.APPLICATION_JSON_TYPE);
        request.setAttribute(SecurityFilter.AUTHENTICATION, AUTH);
        var route=(MethodBasedRouteMatch<?,?>)Proxy.newProxyInstance(EvaluationProbe.class.getClassLoader(),
            new Class<?>[]{MethodBasedRouteMatch.class},(p,m,args)->switch(m.getName()) {
                case "getDeclaringType" -> ExecutionController.class;
                case "getMethodName" -> handler;
                case "getArgumentTypes" -> new Class<?>[0];
                case "getVariableValues" -> Map.of("tenant","main");
                case "toString" -> "evaluation probe route metadata";
                default -> throw new UnsupportedOperationException(m.getName());
            });
        RouteAttributes.setRouteMatch(request,route);
        return request;
    }
    static int rest(Policy p) {
        byte[] body="[{\"namespace\":\"team.a\",\"id\":\"a\"},{\"namespace\":\"team.b\",\"id\":\"b\"}]".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var filter=new TypedRestRbacFilter(CONFIG,new OssRestOperationAdapter(null),typed(p),
            new ProblemFactory(new ProblemMapperRegistry(List.of()),new io.kestra.core.utils.EditionProvider()));
        AtomicInteger effects=new AtomicInteger();
        var response=Mono.from(filter.doFilter(request("getLatestExecutions",body),req->{
            effects.incrementAndGet(); return Mono.just(HttpResponse.ok());
        })).block(Duration.ofSeconds(15));
        int status=response.code();
        check(effects.get()==(status==200 ? 1 : 0),"REST continuation count");
        p.report("status="+status+" continuation="+effects);
        return status;
    }
    static boolean runtime(Policy p) {
        McpAuthorizationResolver resolver=(principal,invocation)->CompletableFuture.completedFuture(List.of(
            new RbacAuthorizer.Requirement(new RbacAuthorizer.Resource(RbacAuthorizer.Kind.KVSTORE,
                RbacAuthorizer.Scope.NAMESPACE,"main","team.b","dependency"),RbacAuthorizer.Action.READ)));
        var runtime=new RbacExecutionGate(CONFIG,gate(p),bean(resolver));
        Flow flow=Flow.builder().tenantId("main").namespace("team.a").id("probe").tasks(List.of()).build();
        boolean allowed=Boolean.TRUE.equals(runtime.authorize(AUTH,"main",flow,"execution-probe",false).block());
        p.report("allowed="+allowed);
        return allowed;
    }
    static boolean mcp(Policy p) {
        var capabilities=new McpCapabilityGate(true,true,false,bean(null),CONFIG,gate(p));
        var context=KestraMcpTransportContext.builder().tenantId("main").serverId("default")
            .userId("evaluation-probe").clientId("probe-client").resource("https://example.invalid/mcp")
            .roles(List.of()).scopes(List.of(McpCapabilityGate.FLOW_READ,McpCapabilityGate.EXECUTION_WRITE)).build();
        boolean allowed=Boolean.TRUE.equals(capabilities.execute(context,"main","team.a","probe").block());
        p.report("allowed="+allowed);
        return allowed;
    }
    static void query() {
        var p=new Policy("QUERY-cache",Set.of("FLOW:LIST:null"),Set.of("EXECUTION:LIST:null"),1,0,false);
        var acl=new TypedNamespaceAccessControl(typed(p));
        var request=request("getLatestExecutions",new byte[0]);
        try(var ignored=io.micronaut.core.propagation.PropagatedContext.empty()
            .plus(new AuthorizationInvocationContext(request,false)).propagate()) {
            var flow=acl.domain(QueryFilter.Resource.FLOW);
            var execution=acl.domain(QueryFilter.Resource.EXECUTION);
            var cached=acl.domain(QueryFilter.Resource.FLOW);
            check(flow.contains("team.a") && execution.contains("team.b") && cached.equals(flow) && p.calls==2,
                "query cache must exhibit resource-specific mixed revisions");
            p.report("FLOW="+flow.exactNamespaces()+" EXECUTION="+execution.exactNamespaces()+" cachedFLOW="+cached.exactNamespaces()+" calls="+p.calls);
            mixed++;
        }
        var next=request("getLatestExecutions",new byte[0]);
        try(var ignored=io.micronaut.core.propagation.PropagatedContext.empty()
            .plus(new AuthorizationInvocationContext(next,false)).propagate()) {
            check(acl.domain(QueryFilter.Resource.FLOW).equals(QueryDomain.empty()),"new request must observe V2 FLOW deny");
        }
    }
    public static void main(String[] args) {
        var restA=Set.of("EXECUTION:LIST:team.a"); var restB=Set.of("EXECUTION:LIST:team.b");
        check(rest(new Policy("REST-A-only",restA,restB,1,0,true))==403,"A must deny full plan");
        check(rest(new Policy("REST-B-only",restA,restB,1,1,true))==403,"B must deny full plan");
        check(rest(new Policy("REST-switch",restA,restB,1,0,false))==200,"mixed REST allow must reproduce"); mixed++;
        var runtimeA=Set.of("FLOW:READ:team.a","FLOW:EXECUTE:team.a","EXECUTION:CREATE:team.a");
        var runtimeB=Set.of("KVSTORE:READ:team.b");
        check(!runtime(new Policy("RUNTIME-A-only",runtimeA,runtimeB,3,0,true)),"runtime A must deny dependency");
        check(!runtime(new Policy("RUNTIME-B-only",runtimeA,runtimeB,3,1,true)),"runtime B must deny flow");
        check(runtime(new Policy("RUNTIME-switch",runtimeA,runtimeB,3,0,false)),"runtime dependency mix must reproduce"); mixed++;
        var mcpA=Set.of("FLOW:READ:team.a"); var mcpB=Set.of("FLOW:EXECUTE:team.a");
        check(!mcp(new Policy("MCP-A-only",mcpA,mcpB,1,0,true)),"MCP A must deny");
        check(!mcp(new Policy("MCP-B-only",mcpA,mcpB,1,1,true)),"MCP B must deny");
        check(mcp(new Policy("MCP-switch",mcpA,mcpB,1,0,false)),"MCP mix must reproduce"); mixed++;
        query();
        System.out.println("REPRODUCED mixed boundaries="+mixed+"; no production fix applied");
        if(Arrays.asList(args).contains("--require-coherent"))
            check(mixed==0,"SECURITY EXPECTATION FAILED: complete evaluation combined incompatible policy revisions");
    }
}
