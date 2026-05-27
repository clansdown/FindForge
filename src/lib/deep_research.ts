import { callOpenRouterChat, callOpenRouterWithTools, createUserApiCallMessage, createAssistantApiCallMessage, createSystemApiCallMessage, getModels } from "./models";
import { parseResourcesFromContent, resourceInstructions } from "./resources";
import {
    STRATEGY_PROMPT,
    deepPlanPrompt, deepPlanRefinementPrompt,
    broadPlanPrompt, broadPlanRefinementPrompt,
    SUBQUERY_PROMPT, REFINEMENT_PROMPT,
    SYNTHESIS_PROMPT_INITIAL, SYNTHESIS_PROMPT_REFINEMENT,
} from "./prompts";
import type { ApiCallMessage, DeepResearchResult, ApiCallMessageContent, ModelsForResearch, ChatResult, GenerationData, Annotation, Config, Model, ResearchThread, Resource, ToolCallRecord } from "./types";
import { generateID } from "./util";
import type { ToolRegistry } from "./tools";

export async function doDeepResearch(
    config: Config,
    apiKey : string, 
    maxTokens : number, 
    models : ModelsForResearch,
    strategy : 'deep' | 'broad' | 'auto',
    userMessage: string,
    contextMessages : ApiCallMessage[], 
    statusCallback : (status: string) => void,
    toolRegistry?: ToolRegistry): Promise<DeepResearchResult> {
        const startTime = Date.now(); // Record start time for elapsed_time calculation
        let total_cost = 0;
        let total_web_requests = 0;
        let total_generation_time_ms = 0; // in milliseconds
        let actualStrategy: 'deep' | 'broad' = 'deep'; // default
        let chat_results: ChatResult[] = [];
        let answer_content : string = "";
        let max_subsets = config.deepResearchMaxSubqrequests;
        let plan_prompt : string = '';
        let planResult: ChatResult | null = null;
        let research_threads: ResearchThread[] = [];
        const research_threads_per_phase: number[] = [];
        let allAnnotations: Annotation[] = []; // to collect all annotations
        let allResources: Resource[] = [];
        let plan_prompts: string[] = [];
        let plan_results: ChatResult[] = [];
        let research_plans: string[] = [];
        let research_plan : string = '';
        let synthesisPromptStrings: string[] = [];
        let synthesisResults: ChatResult[] = [];
        const max_planning_requests = config.deepResearchWebSearchMaxPlanningResults;
        const max_planning_tokens = config.deepResearchMaxPlanningTokens;
        const user_api_message = createUserApiCallMessage(userMessage);

        statusCallback("Starting deep research.");

        /**********************************/
        /* Ensure that we have a strategy */
        /**********************************/
        if (strategy === 'auto') {
            statusCallback("Determining research strategy.");
            try {
                const user_api_message = createUserApiCallMessage(userMessage);
                const { strategy: determinedStrategy, chatResult } = await determineStrategy(config, models, contextMessages, user_api_message);
                actualStrategy = determinedStrategy;
                chat_results.push(chatResult);
                if (chatResult.annotations) {
                    allAnnotations.push(...chatResult.annotations);
                }
                if (chatResult.generationData?.generation_time) {
                    total_generation_time_ms += chatResult.generationData.generation_time;
                }
                statusCallback(`Research strategy determined: ${actualStrategy}`);
            } catch (error) {
                console.error('Error determining strategy:', error);
                statusCallback('Error determining strategy, using deep research');
                actualStrategy = 'deep';
            }
            statusCallback(`Using research strategy: ${actualStrategy}`);
        } else {
            actualStrategy = strategy;
        }

        for(let phase_index = 0; phase_index < config.deepResearchPhases; phase_index++) {
            statusCallback(`Research phase ${phase_index + 1} of ${config.deepResearchPhases}.`);
            /*******************/
            /* Create the plan */
            /*******************/
            statusCallback("Creating research plan.");
            if(actualStrategy === 'deep') {
                let plan_prompt_text: string;
                if (phase_index === 0) {
                    plan_prompt_text = deepPlanPrompt(max_subsets);
                } else {
                    plan_prompt_text = deepPlanRefinementPrompt(max_subsets);
                }
                const system_prompt = createSystemApiCallMessage(plan_prompt = plan_prompt_text);
                const messages_for_api: ApiCallMessage[] = phase_index === 0 
                    ? [system_prompt, ...contextMessages, user_api_message]
                    : [system_prompt, ...contextMessages, user_api_message, createAssistantApiCallMessage(`Previous answer:\n${answer_content}`)];

                planResult = await callOpenRouterChat(config, config.deepResearchPlanningModel, max_planning_tokens, max_planning_requests, messages_for_api, undefined, config.deepResearchPlanningEffort);
                total_cost += planResult.cost ?? 0;
                planResult.generationData = {
                    id: planResult.requestID || '',
                    total_cost: planResult.cost ?? 0,
                    model: planResult.model || '',
                    generation_time: 0,
                    provider_name: '',
                    created: Date.now(),
                    streamed: true,
                    canceled: false,
                    finish_reason: planResult.finishReason || 'stop',
                    tokens_prompt: planResult.promptTokens,
                    tokens_completion: planResult.completionTokens,
                };
                research_plan = planResult.content.trim();
                plan_prompts.push(plan_prompt);
                plan_results.push(planResult);
                research_plans.push(research_plan);
                if (planResult.annotations) {
                    allAnnotations.push(...planResult.annotations);
                }
                const planResources = parseResourcesFromContent(research_plan);
                if (planResources.length > 0) {
                    allResources.push(...planResources);
                }
            } else if (actualStrategy === 'broad') {
                let plan_prompt_text: string;
                if (phase_index === 0) {
                    plan_prompt_text = broadPlanPrompt(max_subsets);
                } else {
                    plan_prompt_text = broadPlanRefinementPrompt(max_subsets);
                }
                const system_prompt = createSystemApiCallMessage(plan_prompt = plan_prompt_text);
                const messages_for_api: ApiCallMessage[] = phase_index === 0 
                    ? [system_prompt, ...contextMessages, user_api_message]
                    : [system_prompt, ...contextMessages, user_api_message, createAssistantApiCallMessage(`Previous answer:\n${answer_content}`)];

                planResult = await callOpenRouterChat(config, config.deepResearchPlanningModel, max_planning_tokens, max_planning_requests, messages_for_api, undefined, config.deepResearchPlanningEffort);
                total_cost += planResult.cost ?? 0;
                planResult.generationData = {
                    id: planResult.requestID || '',
                    total_cost: planResult.cost ?? 0,
                    model: planResult.model || '',
                    generation_time: 0,
                    provider_name: '',
                    created: Date.now(),
                    streamed: true,
                    canceled: false,
                    finish_reason: planResult.finishReason || 'stop',
                    tokens_prompt: planResult.promptTokens,
                    tokens_completion: planResult.completionTokens,
                };
                research_plan = planResult.content.trim();
                plan_prompts.push(plan_prompt);
                plan_results.push(planResult);
                research_plans.push(research_plan);
                if(planResult.annotations) {
                    allAnnotations.push(...planResult.annotations);
                }
                const planResources = parseResourcesFromContent(research_plan);
                if (planResources.length > 0) {
                    allResources.push(...planResources);
                }
            }

            /*****************************/
            /* Execute the research plan */
            /*****************************/
            // Extract the prompts from the research_plan
            const promptRegex = /<prompt>(.*?)<\/prompt>/gs;
            const prompts: string[] = [];
            let match;
            while ((match = promptRegex.exec(research_plan)) !== null) {
                prompts.push(match[1].trim());
            }

            statusCallback(`Executing research plan with ${prompts.length} research threads.`);

            // Use the provided userMessage string directly for refinement
            const userQuery = userMessage;

            // Execute all research threads in parallel using execute_research_thread
            const subquerySystemPrompt = SUBQUERY_PROMPT + resourceInstructions;

            const refinementSystemPrompt = REFINEMENT_PROMPT;

            const threadPromises = prompts.map(prompt => 
                execute_research_thread(
                    config,
                    prompt,
                    userQuery,
                    maxTokens,
                    subquerySystemPrompt,
                    refinementSystemPrompt,
                    (data: GenerationData) => {
                        total_cost += data.total_cost || 0;
                        total_web_requests += data.num_search_results || 0;
                        if (data.generation_time) {
                            total_generation_time_ms += data.generation_time;
                        }
                    },
                    toolRegistry
                )
            );

            const phaseThreads = await Promise.all(threadPromises);
            research_threads.push(...phaseThreads);
            research_threads_per_phase.push(phaseThreads.length);

            // Collect all resources and annotations from the threads
            for (const thread of phaseThreads) {
                if (thread.resources) {
                    allResources.push(...thread.resources);
                }
                if (thread.firstPass?.annotations) {
                    allAnnotations.push(...thread.firstPass.annotations);
                }
            }

            statusCallback(`Research plan executed.`);

            /******************************************************/
            /* Wait for all generation data and update totals      */
            /******************************************************/
            /*********************/
            /* Do the synthesis */
            /*********************/
            statusCallback("Synthesizing research results.");
            let synthesis_prompt_string: string;
            if (phase_index === 0) {
                synthesis_prompt_string = SYNTHESIS_PROMPT_INITIAL + config.deepResearchSystemPrompt;
            } else {
                synthesis_prompt_string = SYNTHESIS_PROMPT_REFINEMENT + config.deepResearchSystemPrompt;
            }
            synthesisPromptStrings.push(synthesis_prompt_string);
            const synthesis_system_prompt = createSystemApiCallMessage(synthesis_prompt_string);

            // Construct the messages for synthesis
            const messages_for_synthesis: ApiCallMessage[] = [
                synthesis_system_prompt,
                ...contextMessages,
                user_api_message,
                ...research_threads.map((thread, index) => createAssistantApiCallMessage(`Research Result ${index+1} (Refined):\n${thread.refined?.content}`))
            ];
            
            if (phase_index > 0) {
                messages_for_synthesis.push(createAssistantApiCallMessage(`Previous Answer:\n${answer_content}`));
            }

            const synthesisResponse = await callOpenRouterChat(
                config,
                config.deepResearchSynthesisModel,
                config.deepResearchMaxSynthesisTokens,
                0,   // web requests
                messages_for_synthesis,
                undefined,
                config.deepResearchSynthesisEffort
            );
            synthesisResults.push(synthesisResponse);

            statusCallback("Research synthesis complete.");
            

            total_cost += synthesisResponse.cost ?? 0;
            synthesisResponse.generationData = {
                id: synthesisResponse.requestID || '',
                total_cost: synthesisResponse.cost ?? 0,
                model: synthesisResponse.model || '',
                generation_time: 0,
                provider_name: '',
                created: Date.now(),
                streamed: true,
                canceled: false,
                finish_reason: synthesisResponse.finishReason || 'stop',
                tokens_prompt: synthesisResponse.promptTokens,
                tokens_completion: synthesisResponse.completionTokens,
            };

            // Parse the answer content from the synthesis response and handle annotations
            let synthesisContent = synthesisResponse.content;
            const answerTagRegex = /<ANSWER>(.*?)<\/ANSWER>/s;
            const answerMatch = synthesisContent.match(answerTagRegex);
            if (answerMatch && answerMatch[1]) {
                answer_content = answerMatch[1].trim();
            } else {
                answer_content = synthesisContent;
            }
            if (synthesisResponse.annotations) {
                allAnnotations.push(...synthesisResponse.annotations);
            }
        }

        // Wait for all generation promises in research threads
        statusCallback("Waiting for final generation data...");
        const allThreadGenerationPromises = research_threads.flatMap(thread => thread.generationPromises);
        await Promise.all(allThreadGenerationPromises);

        statusCallback("Deep research completed successfully.");

        const elapsed_time = (Date.now() - startTime) / 1000; // in seconds

        return {
            id: generateID(),
            total_cost,
            models: models,
            planningModel: config.deepResearchPlanningModel,
            researchModel: config.deepResearchResearchModel,
            refiningModel: config.deepResearchRefiningModel,
            synthesisModel: config.deepResearchSynthesisModel,
            plan_prompt,
            plan_result: planResult!,
            research_plan,
            plan_prompts,
            plan_results,
            research_plans,
            research_threads,
            synthesis_prompt: synthesisPromptStrings[0],
            synthesis_result: synthesisResults[0],
            synthesisPromptStrings,
            synthesisResults,
            content: answer_content,
            annotations: allAnnotations,
            resources: allResources,
            total_generation_time: total_generation_time_ms / 1000, // convert to seconds
            elapsed_time,
            contextWasIncluded: true,
            total_research_threads: research_threads.length,
            web_queries_per_thread: config.deepResearchWebRequestsPerSubrequest,
            research_threads_per_phase
        };
}


async function determineStrategy(
    config: Config,
    models: ModelsForResearch,
    messages: ApiCallMessage[],
    userMessage: ApiCallMessage
): Promise<{ strategy: 'deep' | 'broad', chatResult: ChatResult }> {
    const system_prompt : ApiCallMessage = {
        role: 'system',
        content: [{
            type: 'text',
            text: STRATEGY_PROMPT,
        }],
    };
    const messages_for_api : ApiCallMessage[] = [system_prompt, ...messages, userMessage];

    const response = await callOpenRouterChat(
        config,
        models.reasoning,
        500, // maxTokens: we only need a single word
        0,  // maxWebRequests: none for this step
        messages_for_api,
        undefined,
        config.defaultReasoningEffort
    );
    if (response.requestID) {
        response.generationData = {
            id: response.requestID,
            total_cost: response.cost ?? 0,
            model: response.model || '',
            generation_time: 0,
            provider_name: '',
            created: Date.now(),
            streamed: true,
            canceled: false,
            finish_reason: response.finishReason || 'stop',
            tokens_prompt: response.promptTokens,
            tokens_completion: response.completionTokens,
        };
    }

    const strategyResponse = response.content.trim().toLowerCase();
    console.log('Strategy response:', strategyResponse);
    let strategy: 'deep' | 'broad';
    if (strategyResponse === 'deep' || strategyResponse === 'broad') {
        strategy = strategyResponse;
    } else {
        // try regexes 
        const deepRegex = /deep/i;
        const broadRegex = /broad/i;
        if (deepRegex.test(strategyResponse)) {
            strategy = 'deep';
        } else if (broadRegex.test(strategyResponse)) {
            strategy = 'broad';
        } else {
            // It doesn't matter if it actually is 'unsure', we will default to deep anyway
            strategy = 'deep';
        }
    }

    return { strategy, chatResult: response };
}

function captureToolCalls(result: import("./types").CompletionResult, config: Config, toolRegistry: ToolRegistry): import("./types").ToolCallRecord[] {
    if (!result.toolCalls) return [];
    return result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
        result: '',
        startTimeMs: Date.now(),
        durationMs: 0,
    }));
}

export async function execute_research_thread(
    config: Config,
    prompt: string,
    userQuery: string,
    maxTokens: number,
    systemPromptForSubquery: string,
    systemPromptForRefinement: string,
    handleGenerationData: (data: GenerationData) => void = () => {},
    toolRegistry?: ToolRegistry
): Promise<ResearchThread> {
    // Create the thread object
    const thread: ResearchThread = {
        prompt,
        generationPromises: [],
        handleGenerationData
    };

    /*********************/
    /* First pass: sub-query */
    /*********************/
    const subquery_system_prompt = createSystemApiCallMessage(systemPromptForSubquery);
    const messages_for_subquery: ApiCallMessage[] = [
        subquery_system_prompt,
        {
            role: 'user',
            content: [{ type: 'text', text: prompt }]
        }
    ];

    let firstPassContent: string;
    let firstPassResult: ChatResult;
    if (toolRegistry && toolRegistry.getDefinitions().length > 0) {
        const result = await callOpenRouterWithTools({
            config,
            modelId: config.deepResearchResearchModel,
            messages: messages_for_subquery,
            maxTokens,
            tools: toolRegistry.getDefinitions(),
            stream: false,
            signal: undefined,
            reasoningEffort: config.deepResearchResearchEffort,
        });
        thread.toolCallRecords = captureToolCalls(result, config, toolRegistry);
        firstPassContent = result.content;
        firstPassResult = {
            requestID: result.requestID,
            model: result.model,
            created: Date.now(),
            done: true,
            content: result.content,
            annotations: result.annotations,
            totalTokens: result.totalTokens,
        };
        thread.firstPass = firstPassResult;
    } else {
        firstPassResult = await callOpenRouterChat(
            config,
            config.deepResearchResearchModel,
            maxTokens,
            config.deepResearchWebRequestsPerSubrequest,
            messages_for_subquery,
            undefined,
            config.deepResearchResearchEffort
        );
        thread.firstPass = firstPassResult;
        firstPassContent = firstPassResult.content;
    }
    // Extract resources from first pass content
    thread.resources = parseResourcesFromContent(firstPassContent);

    if (firstPassResult.requestID) {
        firstPassResult.generationData = {
            id: firstPassResult.requestID,
            total_cost: firstPassResult.cost ?? 0,
            model: firstPassResult.model || '',
            generation_time: 0,
            provider_name: '',
            created: Date.now(),
            streamed: true,
            canceled: false,
            finish_reason: firstPassResult.finishReason || 'stop',
            tokens_prompt: firstPassResult.promptTokens,
            tokens_completion: firstPassResult.completionTokens,
        };
        thread.handleGenerationData(firstPassResult.generationData);
    }

    /*********************/
    /* Refinement pass */
    /*********************/
    thread.refiningPrompt = systemPromptForRefinement;
    const systemPrompt = createSystemApiCallMessage(systemPromptForRefinement);

    // Use content without resources for refinement
    let contentToRefine = thread.firstPass?.content || '';
    // Remove RESOURCES section if present
    const resourcesStart = contentToRefine.indexOf('<RESOURCES>');
    if (resourcesStart !== -1) {
        const resourcesEnd = contentToRefine.indexOf('</RESOURCES>', resourcesStart);
        if (resourcesEnd !== -1) {
            contentToRefine = contentToRefine.substring(0, resourcesStart) + contentToRefine.substring(resourcesEnd + '</RESOURCES>'.length);
        }
    }

    const userMessage: ApiCallMessage = {
        role: 'user',
        content: [{
            type: 'text',
            text: userQuery
        }]
    };

    const assistantMessage: ApiCallMessage = {
        role: 'assistant',
        content: [{
            type: 'text',
            text: `Research result to refine:\n${contentToRefine}`
        }]
    };

    const messages: ApiCallMessage[] = [systemPrompt, userMessage, assistantMessage];

    let refinedResult: ChatResult;
    if (toolRegistry && toolRegistry.getDefinitions().length > 0) {
        const result = await callOpenRouterWithTools({
            config,
            modelId: config.deepResearchRefiningModel,
            messages,
            maxTokens,
            tools: toolRegistry.getDefinitions(),
            stream: false,
            signal: undefined,
            reasoningEffort: config.deepResearchRefiningEffort,
        });
        if (result.toolCalls && !thread.toolCallRecords) {
            thread.toolCallRecords = captureToolCalls(result, config, toolRegistry);
        } else if (result.toolCalls && thread.toolCallRecords) {
            thread.toolCallRecords.push(...captureToolCalls(result, config, toolRegistry));
        }
        refinedResult = {
            requestID: result.requestID,
            model: result.model,
            created: Date.now(),
            done: true,
            content: result.content,
            annotations: result.annotations,
            totalTokens: result.totalTokens,
        };
        thread.refined = refinedResult;
    } else {
        refinedResult = await callOpenRouterChat(
            config,
            config.deepResearchRefiningModel,
            maxTokens,
            0,   // no web requests for refinement
            messages,
            undefined,
            config.deepResearchRefiningEffort
        );
        thread.refined = refinedResult;
    }

    if (refinedResult.requestID) {
        refinedResult.generationData = {
            id: refinedResult.requestID,
            total_cost: refinedResult.cost ?? 0,
            model: refinedResult.model || '',
            generation_time: 0,
            provider_name: '',
            created: Date.now(),
            streamed: true,
            canceled: false,
            finish_reason: refinedResult.finishReason || 'stop',
            tokens_prompt: refinedResult.promptTokens,
            tokens_completion: refinedResult.completionTokens,
        };
        thread.handleGenerationData(refinedResult.generationData);
    }

    return thread;
}

export async function estimateDeepResearchCost(config: Config): Promise<number> {
    console.log("Estimating deep research cost. ", config.defaultModel, config.defaultReasoningModel);
    if(!config.apiKey) {
        console.warn("No API key provided, returning cost as $0.");
        return 0; // Without an API key you can't do research, and no queries costs $0
    }
    // Fetch the models to get pricing
    const modelsList = await getModels(config);
    const modelPricing: Record<string, { prompt: number, completion: number }> = {};
    for (const model of modelsList) {
        // Convert the pricing strings to numbers (remove the dollar sign)
        modelPricing[model.id] = {
            prompt: parseFloat(model.pricing.prompt.replace('$', '')),
            completion: parseFloat(model.pricing.completion.replace('$', ''))
        };
    }

    // Step 1: Strategy determination (if auto) - we always include it for estimation
    const reasoningModel = config.defaultReasoningModel;
    const pricingStrategy = modelPricing[reasoningModel];
    const strategyInputTokens = 1100; // 1000 (user) + 100 (system)
    const strategyOutputTokens = 500;  // just the word
    const strategyCost = (strategyInputTokens * pricingStrategy.prompt + strategyOutputTokens * pricingStrategy.completion);

    // Step 2: Planning
    const pricingPlanning = modelPricing[reasoningModel];
    const planningInputTokens = 4300; // 300 (system) + 1000 (user) + 3000 (research)
    const planningOutputTokens = config.deepResearchMaxPlanningTokens;
    const planningCost = config.deepResearchPhases * (planningInputTokens * pricingPlanning.prompt + planningOutputTokens * pricingPlanning.completion);

    // Step 3: Execution of subqueries
    const researcherModel = config.defaultModel;
    const pricingResearcher = modelPricing[researcherModel];
    const numSubqueries = config.deepResearchMaxSubqrequests;
    const perSubqueryInputTokens = 200 + config.deepResearchWebRequestsPerSubrequest*600; // system (100) + prompt (100)
    const perSubqueryOutputTokens = 1000;
    const executionCost = config.deepResearchPhases * numSubqueries * (perSubqueryInputTokens * pricingResearcher.prompt + perSubqueryOutputTokens * pricingResearcher.completion);

    // Step 4: Refinement
    const editorModel = config.defaultReasoningModel; // using reasoning model for refinement
    const pricingEditor = modelPricing[editorModel];
    const perRefinementInputTokens = 100 + 1000 + perSubqueryOutputTokens; // system (100) + user query (1000) + subquery result (1000)
    const perRefinementOutputTokens = 1000;
    const refinementCost = config.deepResearchPhases * numSubqueries * (perRefinementInputTokens * pricingEditor.prompt + perRefinementOutputTokens * pricingEditor.completion);

    // Step 5: Synthesis
    const synthesisInputTokens = 200 + 1000 + strategyOutputTokens + (perRefinementOutputTokens * numSubqueries); // system (200) + user messages (1000)
    const synthesisOutputTokens = config.deepResearchMaxSynthesisTokens;
    const synthesisCost = config.deepResearchPhases * (synthesisInputTokens * pricingPlanning.prompt + synthesisOutputTokens * pricingPlanning.completion);

    // Web search cost
    const webSearchCost = (config.deepResearchWebSearchMaxPlanningResults + (config.deepResearchWebRequestsPerSubrequest * numSubqueries * config.deepResearchPhases)) * 0.004;

    // Total cost
    const totalCost = strategyCost + planningCost + executionCost + refinementCost + synthesisCost + webSearchCost;

    // Log all of the costs that went into total cost:
    // console.log(`Strategy cost: $${strategyCost.toFixed(3)}`);
    // console.log(`Planning cost: $${planningCost.toFixed(3)}`);
    // console.log(`Execution cost: $${executionCost.toFixed(3)}`);
    // console.log(`Refinement cost: $${refinementCost.toFixed(3)}`);
    // console.log(`Synthesis cost: $${synthesisCost.toFixed(3)}`);
    // console.log(`Web search cost: $${webSearchCost.toFixed(3)}`);
    // console.log(`Estimated deep research cost: $${totalCost.toFixed(3)}`);
    return totalCost;
}

