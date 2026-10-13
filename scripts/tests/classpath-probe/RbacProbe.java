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
public class RbacProbe implements RbacAuthorizer, RestAuthorizationResolver, McpAuthorizationResolver {
    public RbacProbe() { System.out.println("RBAC-CLASSPATH-PROBE-DISCOVERED"); }
    @Override public CompletionStage<Boolean> authorize(Principal principal,Resource resource,Action action) {
        return CompletableFuture.completedFuture(false);
    }
    @Override public CompletionStage<Plan> resolve(Principal principal,Request request) {
        return CompletableFuture.completedFuture(null);
    }
    @Override public CompletionStage<List<Requirement>> resolve(Principal principal,Invocation invocation) {
        return CompletableFuture.completedFuture(null);
    }
}
