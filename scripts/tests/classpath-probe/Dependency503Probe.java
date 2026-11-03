package io.kestra.overlay.probe;

import io.kestra.webserver.oidc.*;
import io.kestra.webserver.rbac.*;
import io.micronaut.context.annotation.Requires;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.context.annotation.Value;
import jakarta.inject.Singleton;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.*;
import java.util.concurrent.*;

@Singleton
@Requires(property="kestra.dependency503.probe.enabled",value="true")
public final class Dependency503Probe implements ApplicationGroupProtocolProjectionV2,AuthorizationEvaluationProviderV2,OidcInitialAccountParticipantV1 {
    @Value("${kestra.oidc.issuer}") String issuer;
    public void initialize(Connection connection,InitialAccount account)throws SQLException {
        if(account==null || !Objects.equals(issuer,account.issuer())
            || !"kestra-ui".equals(account.configuredLoginClientId()) || !"tester".equals(account.subject())
            || !UUID.fromString(account.installationId()).toString().equals(account.installationId())
            || connection==null || connection.isClosed() || connection.getAutoCommit() || connection.isReadOnly()
            || connection.getTransactionIsolation()!=Connection.TRANSACTION_READ_COMMITTED) {
            throw new IllegalStateException("Invalid initial account probe context");
        }
        try(var statement=connection.createStatement();var rows=statement.executeQuery(
            "SELECT (SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND objid IN (1380073797,1330133)),(SELECT count(*) FROM oidc_user),(SELECT count(*) FROM oidc_setup)")) {
            if(!rows.next() || rows.getInt(1)!=2 || rows.getInt(2)!=0 || rows.getInt(3)!=0) {
                throw new IllegalStateException("Invalid initial account probe transaction");
            }
        }
    }
    public ApplicationGroupProtocolProjectionV2.Result currentResources(Connection connection,Request request)throws SQLException {
        try(var statement=connection.createStatement();var rows=statement.executeQuery("SELECT available FROM host_dependency503_probe WHERE singleton")) {
            if(!rows.next())throw new SQLException("Missing probe state");
            return new ApplicationGroupProtocolProjectionV2.Result(2,true,Optional.of(new ApplicationGroupProtocolProjectionV2.Projection(
                "probe","main",issuer,request.clientId(),request.subject(),true,true,1,1,Set.of(),
                List.of(new Scope("probe-read","Probe read","")),Set.of("probe-read"),Set.of("probe-read"))));
        }
    }
    public CompletionStage<AuthorizationEvaluationV1> begin(TrustedIdentityV1.Identity identity,String tenant) {
        return CompletableFuture.completedFuture(new AuthorizationEvaluationV1() {
            public CompletionStage<TypedAuthorization.Decision> authorize(TypedAuthorization.Operation operation) {
                return CompletableFuture.completedFuture(TypedAuthorization.Decision.allow(TypedAuthorization.QueryDomain.unrestricted()));
            }
            public CompletionStage<Void> close(){return CompletableFuture.completedFuture(null);}
        });
    }
}
