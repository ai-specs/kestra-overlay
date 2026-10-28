import com.fasterxml.jackson.databind.ObjectMapper;
import io.kestra.webserver.oidc.UserDirectoryV1;
import io.kestra.webserver.oidc.UserDirectoryV2;
import io.kestra.webserver.oidc.services.OidcUserDirectory;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.postgresql.ds.PGSimpleDataSource;

public final class ProfileDirectoryCommand {
    private static final List<Map<String, Object>> CHECKS = new ArrayList<>();
    private static final ObjectMapper JSON = new ObjectMapper();

    private static void check(String name, boolean passed) {
        CHECKS.add(Map.of("name", name, "passed", passed));
        if (!passed) throw new IllegalStateException("Profile directory assertion failed: " + name);
    }

    private static String snapshot(PGSimpleDataSource source, boolean authenticationOnly) throws Exception {
        var digest = MessageDigest.getInstance("SHA-256");
        try (var connection = source.getConnection(); var statement = connection.createStatement()) {
            for (String table : List.of("oidc_user", "oidc_user_auth_method", "oidc_client", "oidc_token", "oidc_authorization_code", "oidc_password_change")) {
                String expression = authenticationOnly && table.equals("oidc_user")
                    ? "(to_jsonb(profile_row)-'name'-'email'-'email_verified'-'directory_revision'-'updated_at')::text"
                    : "to_jsonb(profile_row)::text";
                try (var rows = statement.executeQuery("SELECT " + expression + " FROM " + table + " profile_row ORDER BY 1")) {
                    while (rows.next()) digest.update((table + "\n" + rows.getString(1) + "\n").getBytes(StandardCharsets.UTF_8));
                }
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static boolean readable(UserDirectoryV2 directory, UserDirectoryV1.User user) {
        if (!directory.find(user.subject()).orElseThrow().equals(user)) return false;
        for (int page = 1; ; page++) {
            var result = directory.list(page, 100);
            if (result.items().contains(user)) return true;
            if ((long) page * 100 >= result.total()) return false;
        }
    }

    private static boolean rejected(Runnable action, UserDirectoryV1.Failure expected) {
        try { action.run(); return false; }
        catch (UserDirectoryV1.DirectoryException failure) { return failure.failure() == expected; }
    }

    private static boolean verified(PGSimpleDataSource source, String subject) throws Exception {
        try (var connection = source.getConnection(); var statement = connection.prepareStatement("SELECT email_verified FROM oidc_user WHERE username=?")) {
            statement.setString(1, subject);
            try (var rows = statement.executeQuery()) { rows.next(); return rows.getBoolean(1); }
        }
    }

    public static void main(String[] arguments) throws Exception {
        var source = new PGSimpleDataSource();
        source.setURL(arguments[0]); source.setUser("kestra"); source.setPassword("local-test-only");
        UserDirectoryV2 directory = new OidcUserDirectory(source);
        if (arguments[1].equals("create")) {
            var user = directory.create("profile-" + UUID.randomUUID(), "Initial", "initial@example.invalid", "ProfileProbeInitial123!");
            System.out.println(JSON.writeValueAsString(Map.of("subject", user.subject())));
            return;
        }
        boolean completed = false;
        try {
            for (String value : new String[] {null, "", "   "}) {
                var user = directory.createTemporary("empty-profile-" + UUID.randomUUID(), value, value).user();
                check("temporary-" + (value == null ? "absent" : value.isEmpty() ? "empty" : "blank") + "-find-list", user.name().equals("") && user.email().equals("") && readable(directory, user));
            }
            String legacySubject = "legacy-profile-" + UUID.randomUUID();
            var legacy = directory.create(legacySubject, null, null, "ProfileProbeInitial123!");
            check("v1-null-defaults-unchanged", legacy.name().equals(legacySubject) && legacy.email().equals(legacySubject + "@localhost") && readable(directory, legacy));
            String subject = arguments[2];
            var original = directory.find(subject).orElseThrow();
            String authentication = snapshot(source, true);
            try (var connection = source.getConnection(); var statement = connection.prepareStatement("UPDATE oidc_user SET email_verified=true WHERE username=?")) {
                statement.setString(1, subject); statement.executeUpdate();
            }
            var user = directory.update(subject, original.revision(), "Changed", original.email());
            check("same-email-keeps-verification", verified(source, subject) && readable(directory, user));
            user = directory.update(subject, user.revision(), "Updated", "updated@example.invalid");
            check("nonempty-update-clears-verification", !verified(source, subject) && user.name().equals("Updated") && readable(directory, user));
            user = directory.update(subject, user.revision(), "", user.email());
            check("clear-name-only-find-list", user.name().isEmpty() && user.email().equals("updated@example.invalid") && readable(directory, user));
            user = directory.update(subject, user.revision(), "Name", "");
            check("clear-email-only-find-list", user.name().equals("Name") && user.email().isEmpty() && readable(directory, user));
            user = directory.update(subject, user.revision(), "Refilled", "refilled@example.invalid");
            check("refill-after-clear-find-list", user.name().equals("Refilled") && user.email().equals("refilled@example.invalid") && readable(directory, user));
            long revision = user.revision();
            user = directory.update(subject, revision, "", "");
            check("clear-both-find-list-revision", user.name().isEmpty() && user.email().isEmpty() && user.revision() == revision + 1 && readable(directory, user));
            user = directory.update(subject, user.revision(), null, null);
            check("null-update-normalized-find-list", user.name().isEmpty() && user.email().isEmpty() && readable(directory, user));
            user = directory.update(subject, user.revision(), "   ", "   ");
            check("blank-update-normalized-find-list", user.name().isEmpty() && user.email().isEmpty() && readable(directory, user));
            long current = user.revision();
            String baseline = snapshot(source, false);
            check("stale-cas-no-side-effects", rejected(() -> directory.update(subject, current - 1, "Stale", "stale@example.invalid"), UserDirectoryV1.Failure.CONFLICT) && baseline.equals(snapshot(source, false)));
            boolean invalidFields = true;
            for (String invalid : new String[] {"x".repeat(257), " ".repeat(257), " leading", "trailing ", "\n", "bad\u0000value"}) {
                invalidFields &= rejected(() -> directory.update(subject, current, invalid, ""), UserDirectoryV1.Failure.INVALID);
                invalidFields &= rejected(() -> directory.update(subject, current, "", invalid), UserDirectoryV1.Failure.INVALID);
                invalidFields &= rejected(() -> directory.createTemporary("invalid-profile-" + UUID.randomUUID(), invalid, ""), UserDirectoryV1.Failure.INVALID);
                invalidFields &= rejected(() -> directory.createTemporary("invalid-profile-" + UUID.randomUUID(), "", invalid), UserDirectoryV1.Failure.INVALID);
            }
            check("invalid-profile-boundaries-no-side-effects", invalidFields && baseline.equals(snapshot(source, false)));
            check("invalid-subject-no-side-effects", rejected(() -> directory.update(" " + subject, current, "", ""), UserDirectoryV1.Failure.INVALID) && baseline.equals(snapshot(source, false)));
            boolean wrongType = false;
            try { UserDirectoryV1.class.getMethod("update", String.class, long.class, String.class, String.class).invoke(directory, subject, current, 123, ""); }
            catch (IllegalArgumentException expected) { wrongType = true; }
            check("non-string-java-call-rejected-no-side-effects", wrongType && baseline.equals(snapshot(source, false)));
            user = directory.update(subject, current, "x".repeat(256), "y".repeat(256));
            check("256-character-boundary-find-list", user.name().length() == 256 && user.email().length() == 256 && readable(directory, user));
            user = directory.update(subject, user.revision(), "", "");
            check("cleared-email-not-verified", !verified(source, subject));
            check("profile-keeps-all-authentication-state", authentication.equals(snapshot(source, true)));
            check("subject-active-and-final-empty-profile", user.subject().equals(original.subject()) && user.active() == original.active() && user.name().isEmpty() && user.email().isEmpty() && readable(directory, user));
            check("exact-public-directory-check-count", CHECKS.size() == 20);
            completed = true;
        } finally {
            System.out.println(JSON.writeValueAsString(Map.of("completed", completed, "checks", CHECKS)));
        }
    }
}
