import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.Function;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/** Investigation model only: this is NOT a published SPI or a host implementation. */
public class LifecycleModel {
    record Handle(int revision, Set<String> grants, AtomicBoolean closed) {
        boolean allows(String requirement) {
            if (closed.get()) throw new IllegalStateException("closed evaluation");
            return grants.contains(requirement);
        }
    }
    static class Provider {
        final AtomicInteger revision=new AtomicInteger();
        final AtomicInteger begins=new AtomicInteger(), closes=new AtomicInteger();
        final List<Handle> handles=new CopyOnWriteArrayList<>();
        Handle begin() {
            int version=revision.get();
            Handle handle=new Handle(version,Set.of(version==0 ? "A" : "B"),new AtomicBoolean());
            begins.incrementAndGet(); handles.add(handle); return handle;
        }
        Mono<Void> close(Handle handle) {
            return Mono.fromRunnable(()->{
                if(!handle.closed().compareAndSet(false,true)) throw new AssertionError("double close");
                closes.incrementAndGet();
            });
        }
    }
    static <T> Mono<T> boundary(Provider p, Function<Handle,Mono<T>> action) {
        return Mono.usingWhen(Mono.fromSupplier(p::begin),
            h->Mono.defer(()->action.apply(h)), p::close,(h,error)->p.close(h),p::close);
    }
    static void check(boolean ok,String message) { if(!ok) throw new AssertionError(message); }
    static void balanced(Provider p,String name) {
        check(p.begins.get()==p.closes.get(),name+" leaked handle");
        System.out.println(name+" begins="+p.begins+" closes="+p.closes);
    }
    public static void main(String[] args) throws Exception {
        var p=new Provider();
        boolean allowed=boundary(p,h->Mono.fromCallable(()->{
            check(h.allows("A"),"initial A");
            p.revision.set(1);
            return h.allows("B");
        }).subscribeOn(Schedulers.boundedElastic())).block();
        check(!allowed,"mixed A+B must deny with explicit immutable handle"); balanced(p,"async complete/mixed deny");
        check(boundary(p,h->Mono.just(h.revision()==1 && h.allows("B") && !h.allows("A"))).block(),"new boundary must read V2");
        balanced(p,"new boundary sees V2");
        check(boundary(p,outer->boundary(p,inner->Mono.just(outer!=inner && !outer.closed().get()))
            .map(ok->ok && !outer.closed().get())).block(),"nested boundary must own a new handle");
        balanced(p,"nested ownership");
        boundary(p,h->Mono.error(new IllegalStateException("probe exception"))).onErrorReturn(false).block();
        balanced(p,"exception");
        boundary(p,h->{throw new IllegalStateException("synchronous action exception");}).onErrorReturn(false).block();
        balanced(p,"synchronous exception");
        boundary(p,h->Mono.never()).timeout(Duration.ofMillis(25)).onErrorReturn(false).block();
        balanced(p,"timeout");
        var ready=new CountDownLatch(1);
        var subscription=boundary(p,h->{ready.countDown();return Mono.never();}).subscribe();
        check(ready.await(2,TimeUnit.SECONDS),"cancel test did not acquire handle");
        subscription.dispose(); balanced(p,"cancel");
        for(var h:p.handles) {
            try { h.allows("A"); throw new AssertionError("released handle reused"); }
            catch(IllegalStateException expected) {}
        }
        System.out.println("MODEL ONLY: explicit immutable handle and usingWhen cleanup verified; host integration remains unimplemented");
    }
}
