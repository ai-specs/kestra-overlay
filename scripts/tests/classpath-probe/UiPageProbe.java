package io.kestra.overlay.probe;

import java.util.List;
import java.util.Map;
import java.util.HexFormat;
import java.security.MessageDigest;
import io.kestra.webserver.ui.UiExtensionDescriptorV1;
import io.kestra.webserver.ui.UiExtensionProviderV1;
import io.micronaut.context.annotation.Requires;
import jakarta.inject.Singleton;

@Singleton
@Requires(property = "kestra.ui-extension.probe.enabled", value = "true")
public final class UiPageProbe implements UiExtensionProviderV1 {
    @Override public List<UiExtensionDescriptorV1> extensions() {
        try (var resource = getClass().getClassLoader().getResourceAsStream("ui-extensions/host-probe/page.js")) {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(resource.readAllBytes()));
            return List.of(new UiExtensionDescriptorV1(1, "host-probe", "ui-extensions/host-probe", "page.js", List.of(),
                Map.of("page.js", new UiExtensionDescriptorV1.Resource(hash, "application/javascript")), Map.of("en", "Host extension probe"), null));
        } catch (Exception failure) { throw new IllegalStateException("Cannot load host-owned page probe", failure); }
    }
}
