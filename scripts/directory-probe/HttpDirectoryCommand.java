import io.kestra.webserver.oidc.services.OidcUserDirectory;
import org.postgresql.ds.PGSimpleDataSource;

public class HttpDirectoryCommand {
    public static void main(String[] arguments) {
        var source = new PGSimpleDataSource();
        source.setURL(arguments[0]);
        source.setUser("kestra");
        source.setPassword("local-test-only");
        var directory = new OidcUserDirectory(source);
        var user = directory.find("tester").orElseThrow();
        switch (arguments[1]) {
            case "disable" -> directory.setActive(user.subject(), user.revision(), false);
            case "enable" -> directory.setActive(user.subject(), user.revision(), true);
            case "reset" -> directory.resetPassword(user.subject(), user.revision(), "DirectoryReset123!");
            case "restore" -> directory.resetPassword(user.subject(), user.revision(), "Passw0rd!");
            default -> throw new IllegalArgumentException("Unknown controlled directory operation");
        }
        System.out.println("Controlled directory operation committed");
    }
}
