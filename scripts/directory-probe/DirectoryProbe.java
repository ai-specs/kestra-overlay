import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import javax.sql.DataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.oauth2.sdk.Scope;
import io.kestra.webserver.oidc.OidcConfiguration;
import io.kestra.webserver.oidc.services.OidcJwkService;
import io.kestra.webserver.oidc.services.OidcSessionService;
import io.kestra.webserver.oidc.services.OidcTokenService;
import io.kestra.webserver.oidc.services.OidcUserService;

public class DirectoryProbe {
    static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] arguments) throws Exception {
        DataSource source = new DataSource() {
            public Connection getConnection() throws SQLException {
                return DriverManager.getConnection(System.getenv("DIRECTORY_PROBE_JDBC"), "postgres", "probe-only");
            }
            public Connection getConnection(String username, String password) throws SQLException { return getConnection(); }
            public java.io.PrintWriter getLogWriter() { return null; }
            public void setLogWriter(java.io.PrintWriter writer) {}
            public void setLoginTimeout(int seconds) {}
            public int getLoginTimeout() { return 0; }
            public java.util.logging.Logger getParentLogger() { return java.util.logging.Logger.getGlobal(); }
            public <Target> Target unwrap(Class<Target> type) throws SQLException { throw new SQLException("unsupported"); }
            public boolean isWrapperFor(Class<?> type) { return false; }
        };
        ObjectMapper mapper = new ObjectMapper();
        OidcUserService users = new OidcUserService(source, mapper);
        users.create(new OidcUserService.CreateUserRequest("directory-probe", "Probe", "probe@example.invalid", "OriginalProbe123!", List.of()));
        users.create(new OidcUserService.CreateUserRequest("directory-probe", "Conflict", "other@example.invalid", "ReplacementProbe123!", List.of("admin")));
        require(!users.validateCredentials("directory-probe", "OriginalProbe123!"), "original password unexpectedly preserved");
        require(users.validateCredentials("directory-probe", "ReplacementProbe123!"), "duplicate create did not reproduce password overwrite");
        require(users.bySubject("directory-probe").orElseThrow().roles().isEmpty(), "duplicate changed roles");
        System.out.println("REPRODUCED duplicate create changed existing password while retaining existing roles");

        OidcConfiguration configuration = new OidcConfiguration();
        OidcSessionService sessions = new OidcSessionService(configuration);
        String session = sessions.create("directory-probe");
        OidcTokenService tokens = new OidcTokenService(source, mapper, configuration, new OidcJwkService(source));
        try (Connection connection = source.getConnection(); var statement = connection.prepareStatement(
            "INSERT INTO oidc_client(client_id,client_kind,active) VALUES ('probe-client','system',true)")) {
            statement.executeUpdate();
        }
        String token = tokens.issueAccessToken("probe-client", "directory-probe", "Probe", "probe@example.invalid", List.of(), new Scope("openid")).getValue();
        tokens.validateAccessToken(token);
        users.setPassword("directory-probe", "RotatedProbe123!");
        require(sessions.subject(session).isPresent(), "reset unexpectedly revoked IdP session");
        tokens.validateAccessToken(token);
        System.out.println("REPRODUCED password reset retains existing IdP session and access token");

        users.updateUserState("directory-probe", "INACTIVE");
        require(!users.validateCredentials("directory-probe", "RotatedProbe123!"), "inactive password login allowed");
        require(users.bySubject("directory-probe").isEmpty(), "inactive subject allowed");
        require(sessions.subject(session).isPresent(), "inactive unexpectedly revoked IdP session");
        boolean tokenRejected = false;
        try { tokens.validateAccessToken(token); }
        catch (io.kestra.webserver.oidc.OidcException denied) { tokenRejected = true; }
        require(tokenRejected, "inactive access token accepted");
        System.out.println("VERIFIED inactive rejects password and access token; IdP session lookup still returns subject");
        users.updateUserState("directory-probe", "ACTIVE");
        tokens.validateAccessToken(token);
        System.out.println("REPRODUCED reactivation revives old access token without password login");
        System.out.println("DIRECTORY COMPONENT PROBE PASS; HTTP/UI JWT/MCP session checks remain unverified");
    }
}
