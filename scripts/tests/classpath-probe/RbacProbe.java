package io.kestra.overlay.probe;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import io.kestra.webserver.rbac.*;
import io.micronaut.context.annotation.Context;
import io.micronaut.context.annotation.Requires;

/** Independent protocol probe; no business model, deliberately denies every operation. */
@Context
@Requires(property="kestra.rbac.probe.enabled",value="true")
public class RbacProbe implements RbacAuthorizer, RestAuthorizationResolver, McpAuthorizationResolver,
    HttpExtensionRouteProviderV1 {
    private final io.micronaut.context.BeanContext context;
    public RbacProbe(io.micronaut.context.BeanContext context) {
        this.context = context;
        System.out.println("RBAC-CLASSPATH-PROBE-DISCOVERED");
    }
    @io.micronaut.runtime.event.annotation.EventListener
    public void discovered(io.micronaut.context.event.StartupEvent event) {
        var providers = context.getBeansOfType(HttpExtensionRouteProviderV1.class);
        if (providers.stream().filter(provider -> provider == this).count() != 1)
            throw new IllegalStateException("External provider V1 not discovered by BeanContext");
        System.out.println("HTTP-EXTENSION-PROVIDER-PROBE-DISCOVERED");
    }
    @Override public String id() { return "host-classpath-probe"; }
    @Override public CompletionStage<Boolean> authorize(Principal principal,Resource resource,Action action) {
        return CompletableFuture.completedFuture(false);
    }
    @Override public CompletionStage<Plan> resolve(Principal principal,Request request) {
        return CompletableFuture.completedFuture(null);
    }
    @Override public CompletionStage<List<Requirement>> resolve(Principal principal,Invocation invocation) {
        return CompletableFuture.completedFuture(null);
    }
    @Override public java.util.Optional<Target> match(io.micronaut.http.HttpMethod method, String rawPath) {
        return java.util.Optional.empty();
    }
    @Override public org.reactivestreams.Publisher<io.micronaut.http.MutableHttpResponse<?>> handle(
        io.micronaut.http.HttpRequest<?> request, Target target) {
        return reactor.core.publisher.Mono.error(new IllegalStateException("classpath probe handler must not run"));
    }
}
