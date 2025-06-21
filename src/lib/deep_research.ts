import { callOpenRouterChat, createUserApiCallMessage, createAssistantApiCallMessage, createSystemApiCallMessage, fetchGenerationData, getModels } from "./models";
import { parseResourcesFromContent, resourceInstructions } from "./resources";
import type { ApiCallMessage, DeepResearchResult, ApiCallMessageContent, ModelsForResearch, ChatResult, GenerationData, Annotation, Config, Model, ResearchThread, Resource } from "./types";
import { generateID } from "./util";

async function attachGenerationData(apiKey: string, chatResult: ChatResult): Promise<void> {
    const generationData = await fetchGenerationData(apiKey, chatResult.requestID);
    if (generationData) {
        chatResult.generationData = generationData;
    }
}



export async function doDeepResearch(
    config: Config,
    apiKey : string, 
    maxTokens : number, 
    models : ModelsForResearch,
    strategy : 'deep' | 'broad' | 'auto',
    userMessage: string,
    contextMessages : ApiCallMessage[], 
    statusCallback : (status: string) => void): Promise<DeepResearchResult> {
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
                const { strategy: determinedStrategy, chatResult } = await determineStrategy(apiKey, models, contextMessages, user_api_message, config.defaultReasoningEffort);
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
                    plan_prompt_text = `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be clear and specific, and should not require any further clarification from the user. The prompts should be designed to gather information that is relevant to the user's question or goal, and should not include any unnecessary or irrelevant information. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question or goal. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with </prompt>. Wrap any reasoning you do in <REASONING> and </REASONING>`;
                } else {
                    plan_prompt_text = `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and the previous answer (shown below) to create a plan for further researching the user's question or goal. Focus on anything in the user's question or goal which may not have been addressed in the first answer. Secondarily, consider anything that could use elaboration or further detail. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each of which should be a single question or task that will help you improve upon or verify the previous answer. Each prompt should be clear and specific, and should not require any further clarification from the user. The prompts should be designed to gather information that is relevant to improving or verifying the previous answer, and should not include any unnecessary or irrelevant information. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a better final answer or solution to the user's question or goal. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with </prompt>. Wrap any reasoning you do in <REASONING> and </REASONING>`;
                }
                const system_prompt = createSystemApiCallMessage(plan_prompt = plan_prompt_text);
                const messages_for_api: ApiCallMessage[] = phase_index === 0 
                    ? [system_prompt, ...contextMessages, user_api_message]
                    : [system_prompt, ...contextMessages, user_api_message, createAssistantApiCallMessage(`Previous answer:\n${answer_content}`)];

                planResult = await callOpenRouterChat(apiKey, config.deepResearchPlanningModel, max_planning_tokens, max_planning_requests, messages_for_api, undefined, config.defaultReasoningEffort);
                fetchGenerationData(apiKey, planResult.requestID).then(data => {
                    if(data) {
                        total_cost += data.total_cost || 0;
                        total_web_requests += data.num_search_results || 0;
                        if (data.generation_time) {
                            total_generation_time_ms += data.generation_time;
                        }
                        planResult!.generationData = data; // attach generation data to the response
                    }
                });
                research_plan = planResult.content.trim();
                plan_prompts.push(plan_prompt);
                plan_results.push(planResult);
                research_plans.push(research_plan);
                if (planResult.annotations) {
                    allAnnotations.push(...planResult.annotations);
                }
            } else if (actualStrategy === 'broad') {
                let plan_prompt_text: string;
                if (phase_index === 0) {
                    plan_prompt_text = `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be designed to gather a broad overview of the topic and should not focus on any one aspect too deeply. The prompts should be clear and specific, and should not require any further clarification from the user. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with "</prompt>. Wrap any reasoning you do in <REASONING> and </REASONING>"`;
                } else {
                    plan_prompt_text = `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and the previous answer (shown below) to create an improved broad research plan. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each designed to gather additional broad information that complements or verifies the previous answer. Each prompt should cover a different aspect of the topic broadly and should not focus too deeply on any one area. The prompts should be clear and specific, and should not require any further clarification from the user. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a more comprehensive final answer. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with "</prompt>". Wrap any reasoning you do in <REASONING> and </REASONING>`;
                }
                const system_prompt = createSystemApiCallMessage(plan_prompt = plan_prompt_text);
                const messages_for_api: ApiCallMessage[] = phase_index === 0 
                    ? [system_prompt, ...contextMessages, user_api_message]
                    : [system_prompt, ...contextMessages, user_api_message, createAssistantApiCallMessage(`Previous answer:\n${answer_content}`)];

                planResult = await callOpenRouterChat(apiKey, config.deepResearchPlanningModel, max_planning_tokens, max_planning_requests, messages_for_api, undefined, config.defaultReasoningEffort);
                fetchGenerationData(apiKey, planResult.requestID).then(data => {
                    if(data) {
                        total_cost += data.total_cost || 0;
                        total_web_requests += data.num_search_results || 0;
                        planResult!.generationData = data; // attach generation data to the response
                    }
                });
                research_plan = planResult.content.trim();
                plan_prompts.push(plan_prompt);
                plan_results.push(planResult);
                research_plans.push(research_plan);
                if(planResult.annotations) {
                    allAnnotations.push(...planResult.annotations);
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
            const subquerySystemPrompt = `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. The following prompt is designed to gather information that is relevant to a bigger question or goal and will be used to synthesize an answer to it. Your answer will be fed into another LLM, so be clear and detailed in your response. Include any information which might be relevant. Do not worry about politeness or formalities, just provide the information requested.` + resourceInstructions;

            const refinementSystemPrompt = `You are an expert researcher. Your task is to extract and summarize all information from the provided research result that is relevant to the user's original query. Only include information that is relevant or potentially relevant to the query, but include all potentially relevant information, including details. Omit completely irrelevant information. Do not expand on anything. Your output will be fed into an LLM for synthesis. Do not worry about politeness or formalities. The original research result is provided below.`;

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
                    }
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
            statusCallback("Waiting for generation data...");
            // Collect all generation promises from all threads
            const allGenerationPromises: Promise<GenerationData>[] = [];
            for (const thread of research_threads) {
                allGenerationPromises.push(...thread.generationPromises);
            }

            /*********************/
            /* Do the synthesis */
            /*********************/
            statusCallback("Synthesizing research results.");
            let synthesis_prompt_string: string;
            if (phase_index === 0) {
                synthesis_prompt_string = `You are an expert researcher and analyst. Analyze the research results and synthesize them into an answer to the user's question or goal. Wrap any reasoning prior to the answer in <REASONING> and </REASONING> tags. Wrap the answer for the user in <ANSWER> and </ANSWER> tags. ` + config.deepResearchSystemPrompt;
            } else {
                synthesis_prompt_string = `You are an expert researcher and analyst. Analyze the previous answer to the user's question or goal in light of the new research results and refine the answer to create an improved answer. Focus on addressing any gaps, weaknesses, or inaccuracies in the previous answer. Prefer expanding the answer to removing anything. Wrap any reasoning prior to the answer in <REASONING> and </REASONING> tags. Wrap the refined answer for the user in <ANSWER> and </ANSWER> tags. ` + config.deepResearchSystemPrompt;
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
                apiKey,
                config.deepResearchSynthesisModel,
                config.deepResearchMaxSynthesisTokens,
                0,   // web requests
                messages_for_synthesis
            );
            synthesisResults.push(synthesisResponse);

            statusCallback("Research synthesis complete.");
            statusCallback("Fetching synthesis generation data.");
            

            // Fetch the generation data for the synthesis step
            const synthesisGenerationData = await fetchGenerationData(apiKey, synthesisResponse.requestID);
            if (synthesisGenerationData) {
                total_cost += synthesisGenerationData.total_cost || 0;
                total_web_requests += synthesisGenerationData.num_search_results || 0;
                if (synthesisGenerationData.generation_time) {
                    total_generation_time_ms += synthesisGenerationData.generation_time;
                }
                synthesisResponse.generationData = synthesisGenerationData; // attach generation data to the response
            }

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
    apiKey: string,
    models: ModelsForResearch,
    messages: ApiCallMessage[],
    userMessage: ApiCallMessage,
    reasoningEffort: 'low'|'medium'|'high'
): Promise<{ strategy: 'deep' | 'broad', chatResult: ChatResult }> {
    const system_prompt : ApiCallMessage = {
        role: 'system',
        content: [{
            type: 'text',
            text: "Analyze the user's messages (and assistant's messages if there are any) and determine the best research strategy to answer the question or achieve the goal. If the messages indicate a need for deep research, use 'deep'. If they suggest a broad overview, use 'broad'. If unsure, default to 'unsure'. Reply with only those words and no explanation.",
        }],
    };
    const messages_for_api : ApiCallMessage[] = [system_prompt, ...messages, userMessage];

    const response = await callOpenRouterChat(
        apiKey,
        models.reasoning,
        500, // maxTokens: we only need a single word
        0,  // maxWebRequests: none for this step
        messages_for_api,
        undefined,
        reasoningEffort
    );
    const generationData = await fetchGenerationData(apiKey, response.requestID);
    if (generationData) {
        response.generationData = generationData;
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

export async function execute_research_thread(
    config: Config,
    prompt: string,
    userQuery: string,
    maxTokens: number,
    systemPromptForSubquery: string,
    systemPromptForRefinement: string,
    handleGenerationData: (data: GenerationData) => void = () => {}
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

    const firstPassResult = await callOpenRouterChat(
        config.apiKey,
        config.deepResearchResearchModel,
        maxTokens,
        config.deepResearchWebRequestsPerSubrequest,
        messages_for_subquery,
        undefined,
        config.defaultReasoningEffort
    );
    thread.firstPass = firstPassResult;
    // Extract resources from first pass content
    thread.resources = parseResourcesFromContent(firstPassResult.content);

    // Start fetching generation data for first pass
    const firstPassGenPromise = (async () => {
        const data = await fetchGenerationData(config.apiKey, firstPassResult.requestID);
        if (data) {
            firstPassResult.generationData = data;
            thread.handleGenerationData(data);
        }
        return data;
    })();
    thread.generationPromises.push(firstPassGenPromise);

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

    const refinedResult = await callOpenRouterChat(
        config.apiKey,
        config.deepResearchRefiningModel,
        maxTokens,
        0,   // no web requests for refinement
        messages,
        undefined,
        config.defaultReasoningEffort
    );
    thread.refined = refinedResult;

    // Start fetching generation data for refinement
    const refinedGenPromise = (async () => {
        const data = await fetchGenerationData(config.apiKey, refinedResult.requestID);
        if (data) {
            refinedResult.generationData = data;
            thread.handleGenerationData(data);
        }
        return data;
    })();
    thread.generationPromises.push(refinedGenPromise);

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

