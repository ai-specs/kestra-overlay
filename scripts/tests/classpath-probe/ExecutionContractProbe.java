package io.kestra.overlay.probe;

import java.util.List;
import java.util.Map;
import java.util.Set;
import io.kestra.core.models.Label;
import io.kestra.core.models.flows.Flow;
import io.kestra.core.models.flows.FlowInterface;
import io.kestra.core.models.executions.Execution;
import io.kestra.core.models.triggers.AbstractTrigger;
import io.kestra.core.runners.*;
import io.kestra.core.services.*;
import io.kestra.core.repositories.AuthorizationEvaluationContext;
import io.kestra.core.repositories.AuthorizationInvocationContext;
import io.kestra.webserver.rbac.RbacExecutionGate;
import io.micronaut.security.authentication.Authentication;

/** Compile-only consumer. Never invoked: linkage is not execution or authorization acceptance. */
public final class ExecutionContractProbe {
    public static void signatures(RbacExecutionGate gate, WebhookService webhook, FlowInputOutput inputs,
        FlowService flows, ConditionService conditions, ExecutionOutputService outputs, FlowMetaStoreInterface metadata,
        Authentication authentication, Flow flow, AbstractTrigger trigger, List<Label> labels, Set<String> pinned,
        Map<String,Object> values, Execution execution) throws Exception {
        FlowInterface declaration=flow;
        gate.checked(authentication,"main",flow,execution.getId(),false,()->reactor.core.publisher.Mono.just(true));
        gate.finishRequest();
        gate.readResult(authentication,"main",flow.getNamespace(),execution.getId(),()->reactor.core.publisher.Mono.just(true));
        webhook.startExecution(execution);
        RunContext runContext=webhook.runContext(flow,execution);
        inputs.readExecutionInputs(declaration,execution,values);
        inputs.typedOutputs(declaration,execution,values);
        Execution.newExecution(declaration,labels);
        flows.getFailedChecks(flow,values);
        flows.validateForExecution(flow);
        conditions.isValid(trigger,flow,runContext);
        LabelService.labelsExcludingSystem(labels);
        LabelService.withoutPinned(labels,pinned);
        LabelService.forExecution(declaration,labels,execution.getId());
        outputs.getOutputs(execution);
        AuthorizationInvocationContext.captureHostInvocation();
        AuthorizationEvaluationContext.call(()->true);
        FlowMetaStores.findForRuntimeOrRaw(metadata,flow);
    }
}
