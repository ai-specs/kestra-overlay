import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

public class LifecycleFaultProbe {
    record Binding(String subject, String tenant) {}

    static final class Handle {
        final Binding binding;
        final AtomicInteger closes = new AtomicInteger();
        final CompletableFuture<Void> cleanup = new CompletableFuture<>();
        boolean closed;
        boolean throwOnClose;

        Handle(Binding binding) { this.binding = binding; }

        synchronized boolean authorize(Binding caller) {
            if (closed || !binding.equals(caller)) throw new IllegalStateException("invalid binding or closed handle");
            return true;
        }

        synchronized CompletionStage<Void> close() {
            if (!closed) {
                closed = true;
                closes.incrementAndGet();
            }
            if (throwOnClose) throw new IllegalStateException("synchronous close failure");
            return cleanup;
        }
    }

    static final class Owner {
        final Binding binding;
        final CompletableFuture<Handle> acquired = new CompletableFuture<>();
        final CompletableFuture<Void> released = new CompletableFuture<>();
        Handle handle;
        boolean ended;
        int cleanupFailures;

        Owner(Binding binding, CompletionStage<Handle> begin) {
            this.binding = binding;
            begin.whenComplete(this::arrived);
        }

        synchronized void arrived(Handle candidate, Throwable failure) {
            if (failure != null || candidate == null) {
                acquired.completeExceptionally(failure != null ? failure : new IllegalStateException("null begin"));
                released.complete(null);
                return;
            }
            handle = candidate;
            if (ended || !binding.equals(candidate.binding)) {
                ended = true;
                acquired.completeExceptionally(new IllegalStateException("cancelled or mismatched begin"));
                cleanup();
            } else {
                acquired.complete(candidate);
            }
        }

        synchronized void end() {
            if (ended) return;
            ended = true;
            acquired.completeExceptionally(new IllegalStateException("boundary ended"));
            if (handle != null) cleanup();
        }

        void cleanup() {
            try {
                handle.close().whenComplete((ignored, failure) -> {
                    synchronized (this) {
                        if (failure != null) cleanupFailures++;
                        if (failure == null) released.complete(null);
                        else released.completeExceptionally(failure);
                    }
                });
            } catch (Throwable failure) {
                cleanupFailures++;
                released.completeExceptionally(failure);
            }
        }
    }

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    static void rejected(Runnable action, String name) {
        try { action.run(); }
        catch (IllegalStateException expected) { return; }
        throw new AssertionError(name + " accepted");
    }

    static void report(String name) { System.out.println("PASS " + name); }

    public static void main(String[] arguments) throws Exception {
        Binding binding = new Binding("alice", "main");
        Handle handle = new Handle(binding);
        check(handle.authorize(binding), "same identity denied");
        rejected(() -> handle.authorize(new Binding("bob", "main")), "subject mismatch");
        report("subject binding");
        rejected(() -> handle.authorize(new Binding("alice", "other")), "tenant mismatch");
        report("tenant binding");
        for (String order : new String[]{"cancel-first", "begin-first"}) {
            CompletableFuture<Handle> pending = new CompletableFuture<>();
            Owner owner = new Owner(binding, pending);
            Handle candidate = new Handle(binding);
            candidate.cleanup.complete(null);
            if (order.equals("cancel-first")) owner.end();
            pending.complete(candidate);
            owner.end();
            owner.end();
            owner.released.get(1, TimeUnit.SECONDS);
            check(candidate.closes.get() == 1, "lost or duplicate late cleanup");
            rejected(() -> candidate.authorize(binding), "post-close use");
            report(order + " exactly once cleanup");
        }
        for (String mismatch : new String[]{"subject", "tenant"}) {
            Handle candidate = new Handle(mismatch.equals("subject") ? new Binding("bob", "main") : new Binding("alice", "other"));
            candidate.cleanup.complete(null);
            Owner owner = new Owner(binding, CompletableFuture.completedFuture(candidate));
            check(owner.acquired.isCompletedExceptionally(), "mismatched begin accepted");
            owner.released.get(1, TimeUnit.SECONDS);
            check(candidate.closes.get() == 1, "mismatched handle leaked");
            report("begin " + mismatch + " mismatch cleanup");
        }
        Handle broken = new Handle(binding);
        Owner failedClose = new Owner(binding, CompletableFuture.completedFuture(broken));
        failedClose.end();
        broken.cleanup.completeExceptionally(new IllegalStateException("close failure"));
        check(failedClose.released.isCompletedExceptionally() && failedClose.cleanupFailures == 1, "close fault hidden");
        rejected(() -> broken.authorize(binding), "faulted handle reuse");
        report("close failure retained and handle invalidated");
        Handle throwing = new Handle(binding);
        throwing.throwOnClose = true;
        Owner throwingClose = new Owner(binding, CompletableFuture.completedFuture(throwing));
        throwingClose.end();
        throwingClose.end();
        check(throwingClose.released.isCompletedExceptionally() && throwingClose.cleanupFailures == 1 && throwing.closes.get() == 1,
            "synchronous close failure hidden or retried");
        report("synchronous close failure");
        Handle stalled = new Handle(binding);
        Owner slowClose = new Owner(binding, CompletableFuture.completedFuture(stalled));
        slowClose.end();
        try {
            slowClose.released.get(25, TimeUnit.MILLISECONDS);
            throw new AssertionError("close timeout not detected");
        } catch (TimeoutException expected) {
            System.out.println("EXPECTED close timeout; cleanup remains owned");
        }
        stalled.cleanup.complete(null);
        slowClose.released.get(1, TimeUnit.SECONDS);
        check(stalled.closes.get() == 1, "close timeout retried cleanup");
        report("close timeout and late completion");
        Owner failedBegin = new Owner(binding, CompletableFuture.failedFuture(new IllegalStateException("begin failure")));
        check(failedBegin.acquired.isCompletedExceptionally(), "begin fault accepted");
        report("begin failure");
        Owner nullBegin = new Owner(binding, CompletableFuture.completedFuture(null));
        check(nullBegin.acquired.isCompletedExceptionally(), "null begin accepted");
        report("null begin");
        for (int iteration = 0; iteration < 100; iteration++) {
            CompletableFuture<Handle> pending = new CompletableFuture<>();
            Owner owner = new Owner(binding, pending);
            Handle candidate = new Handle(binding);
            candidate.cleanup.complete(null);
            CompletableFuture<Void> start = new CompletableFuture<>();
            CompletableFuture<Void> cancellation = CompletableFuture.runAsync(() -> { start.join(); owner.end(); });
            CompletableFuture<Void> acquisition = CompletableFuture.runAsync(() -> { start.join(); pending.complete(candidate); });
            start.complete(null);
            CompletableFuture.allOf(cancellation, acquisition).get(2, TimeUnit.SECONDS);
            owner.released.get(1, TimeUnit.SECONDS);
            check(candidate.closes.get() == 1, "concurrent cancel/begin leaked or double closed");
        }
        report("concurrent cancel/begin 100 iterations");
        System.out.println("FAULT MODEL PASS cases=12; candidate ownership model only; no production integration");
    }
}
