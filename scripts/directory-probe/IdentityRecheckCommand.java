import com.fasterxml.jackson.databind.ObjectMapper;
import io.kestra.core.repositories.AuthorizationInvocationContext;
import io.kestra.webserver.oidc.*;
import io.kestra.webserver.oidc.services.*;
import io.micronaut.context.BeanProvider;
import io.micronaut.core.propagation.PropagatedContext;
import io.micronaut.http.HttpRequest;
import io.micronaut.security.authentication.Authentication;
import io.micronaut.security.filters.SecurityFilter;
import java.sql.Connection;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.postgresql.ds.PGSimpleDataSource;

public class IdentityRecheckCommand {
    static final class Provider<Value> implements BeanProvider<Value> {
        private final Value value;
        Provider(Value value){this.value=value;}
        public Value get(){return value;}
        public boolean isUnique(){return value!=null;}
        public boolean isPresent(){return value!=null;}
    }
    static final List<Map<String,Object>> checks=new ArrayList<>();
    static void check(String name,boolean passed) {
        checks.add(Map.of("name",name,"passed",passed));
        if(!passed)throw new IllegalStateException("Identity recheck probe assertion failed");
    }
    public static void main(String[] arguments)throws Exception {
        var source=new PGSimpleDataSource();source.setURL(arguments[0]);source.setUser("kestra");source.setPassword("local-test-only");
        var configuration=new OidcConfiguration();configuration.setIssuer(arguments[1]);
        var protocol=new OidcProtocolState(arguments[1],"kestra-ui",new OidcInstallationReceipt(java.nio.file.Path.of("/tmp/unused-identity-probe-receipt")),new ObjectMapper());
        boolean complete=false;
        try {
            for(String mutation:List.of("delete","disable","version","revoke"))race(source,configuration,protocol,mutation);
            complete=true;
        } finally {
            System.out.println(new ObjectMapper().writeValueAsString(Map.of("completed",complete,"checks",checks,"source","actual-image-public-v2","borrowedConnectionOwnedByCaller",true)));
        }
    }
    static void race(PGSimpleDataSource source,OidcConfiguration configuration,OidcProtocolStateV1 protocol,String mutation)throws Exception {
        String subject="identity-probe-"+UUID.randomUUID();
        var directory=new OidcUserDirectory(source);directory.create(subject,"Identity Probe",subject+"@example.invalid","IdentityProbeOnly123!");
        var granted=new AtomicBoolean(true);var called=new AtomicInteger();
        ApplicationGroupProtocolProjectionV1 projection=(connection,request)->new ApplicationGroupProtocolProjectionV1.Result(1,true,
            Optional.of(new ApplicationGroupProtocolProjectionV1.Projection("probe","main",configuration.getIssuer(),"kestra-ui",subject,true,true,1,1,Set.of("kestra-ui"),
                List.of(new ApplicationGroupProtocolProjectionV1.Scope("manage","Manage","")),Set.of("manage"),granted.get()?Set.of("manage"):Set.of())));
        var identity=new OidcTrustedIdentity(new Provider<>(projection),protocol,configuration,source);
        var authentication=Authentication.build(subject,List.of(),Map.of("iss",configuration.getIssuer(),"aud",Set.of("kestra-ui"),"authentication_version",0L,
            OidcTrustedIdentity.CLAIM,Map.of("application_group_id","probe","client_id","kestra-ui","authorization_version",1L,
                "application_group_scopes",Set.of("manage"),"protocol_scopes",Set.of("openid"))));
        check(mutation+"/identity-before-lock",identity.validate(authentication).subject().equals(subject));
        IdentityLifecycleParticipantV1 participant=(connection,change)->called.incrementAndGet();
        var dispatch=new OidcLifecycleParticipants(new Provider<>(participant),new Provider<TrustedIdentityV2>(identity),configuration);
        var ready=new CountDownLatch(1);
        try(var winner=source.getConnection();var borrowed=source.getConnection();var executor=Executors.newSingleThreadExecutor()) {
            winner.setAutoCommit(false);winner.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            borrowed.setAutoCommit(false);borrowed.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            int backend;
            try(var statement=borrowed.createStatement();var rows=statement.executeQuery("SELECT pg_backend_pid()")){rows.next();backend=rows.getInt(1);}
            protocol.lockSecurityState(winner);
            var task=executor.submit(()->{
                var request=HttpRequest.DELETE("/api/v1/host-probe").setAttribute(SecurityFilter.AUTHENTICATION,authentication);
                try(var scope=PropagatedContext.getOrEmpty().plus(new AuthorizationInvocationContext(request,false)).propagate()) {
                    ready.countDown();
                    try {dispatch.beforeChange(borrowed,IdentityLifecycleParticipantV1.Kind.ACCOUNT_DELETE,"unrelated",null);return null;}
                    catch(IdentityLifecycleGuardV1.Rejected failure){return failure.failure();}
                }
            });
            check(mutation+"/worker-ready",ready.await(5,TimeUnit.SECONDS));
            boolean waiting=false;long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while(!waiting&&System.nanoTime()<deadline) {
                try(var statement=winner.prepareStatement("SELECT wait_event_type FROM pg_stat_activity WHERE pid=?")) {
                    statement.setInt(1,backend);try(var rows=statement.executeQuery()){waiting=rows.next()&&"Lock".equals(rows.getString(1));}
                }
                if(!waiting)Thread.sleep(10);
            }
            check(mutation+"/actual-postgres-lock-wait",waiting);
            try(var statement=winner.prepareStatement(switch(mutation) {
                case "delete"->"DELETE FROM oidc_user WHERE username=?";
                case "disable"->"UPDATE oidc_user SET user_state='INACTIVE' WHERE username=?";
                case "version"->"UPDATE oidc_user SET authentication_version=authentication_version+1 WHERE username=?";
                default->"UPDATE oidc_user SET updated_at=updated_at WHERE username=?";
            })) {
                if(mutation.equals("delete"))try(var credentials=winner.prepareStatement("DELETE FROM oidc_user_auth_method WHERE user_id=?")){credentials.setString(1,subject);credentials.executeUpdate();}
                statement.setString(1,subject);statement.executeUpdate();
            }
            if(mutation.equals("revoke"))granted.set(false);
            winner.commit();
            check(mutation+"/forbidden-not-unavailable",task.get(10,TimeUnit.SECONDS)==IdentityLifecycleGuardV1.Failure.FORBIDDEN);
            check(mutation+"/participant-not-called",called.get()==0);
            check(mutation+"/borrowed-transaction-remains-open",!borrowed.isClosed()&&!borrowed.getAutoCommit());
            borrowed.rollback();
        } finally {
            try(var cleanup=source.getConnection()) {
                cleanup.setAutoCommit(false);
                try(var credentials=cleanup.prepareStatement("DELETE FROM oidc_user_auth_method WHERE user_id=?");var account=cleanup.prepareStatement("DELETE FROM oidc_user WHERE username=?")) {
                    credentials.setString(1,subject);credentials.executeUpdate();account.setString(1,subject);account.executeUpdate();
                }
                cleanup.commit();
            }
        }
    }
}
