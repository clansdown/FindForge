import { callOpenRouterChat, createAssistantApiCallMessage, createSystemApiCallMessage, fetchGenerationData, getModels } from "./models";
import type { ApiCallMessage, DeepResearchResult, ApiCallMessageContent, ModelsForResearch, ChatResult, GenerationData, Annotation, Config, Model, ResearchThread } from "./types";
import { generateID } from "./util";



export async function doDeepResearch(
    config: Config,
    apiKey : string, 
    maxTokens : number, 
    maxWebRequests : number, 
    models : ModelsForResearch,
    strategy : 'deep' | 'broad' | 'auto',
    messages : ApiCallMessage[], 
    statusCallback : (status: string) => void): Promise<DeepResearchResult> {
        let total_cost = 0;
        let total_web_requests = 0;
        let actualStrategy: 'deep' | 'broad' = 'deep'; // default
        let chat_results: ChatResult[] = [];
        let answer_content : string = "";
        let max_subsets = config.deepResearchMaxSubqrequests;
        let plan_prompt : string = '';
        let planResult: ChatResult | null = null;
        let research_threads: ResearchThread[] = [];
        let allAnnotations: Annotation[] = []; // to collect all annotations
        const max_planning_requests = config.deepResearchWebSearchMaxPlanningResults;

        statusCallback("Starting deep research.");

        /**********************************/
        /* Ensure that we have a strategy */
        /**********************************/
        if (strategy === 'auto') {
            statusCallback("Determining research strategy.");
            try {
                const { strategy: determinedStrategy, chatResult } = await determineStrategy(apiKey, models, messages);
                actualStrategy = determinedStrategy;
                chat_results.push(chatResult);
                if (chatResult.annotations) {
                    allAnnotations.push(...chatResult.annotations);
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

        /*******************/
        /* Create the plan */
        /*******************/
        statusCallback("Creating research plan.");
        let research_plan : string = '';
        let max_planning_tokens = config.deepResearchMaxPlanningTokens;
        if(actualStrategy === 'deep') {
            const system_prompt = createSystemApiCallMessage(plan_prompt =
                `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be clear and specific, and should not require any further clarification from the user. The prompts should be designed to gather information that is relevant to the user's question or goal, and should not include any unnecessary or irrelevant information. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question or goal. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with </prompt>`
            );
            const messages_for_api: ApiCallMessage[] = [system_prompt, ...messages];

            planResult = await callOpenRouterChat(apiKey, models.reasoning, max_planning_tokens, max_planning_requests, messages_for_api);
            fetchGenerationData(apiKey, planResult.requestID).then(data => {
                if(data) {
                    total_cost += data.total_cost || 0;
                    total_web_requests += data.num_search_results || 0;
                    planResult!.generationData = data; // attach generation data to the response
                }
            });
            research_plan = planResult.content.trim();
            if (planResult.annotations) {
                allAnnotations.push(...planResult.annotations);
            }
        } else if (actualStrategy === 'broad') {
            const system_prompt = createSystemApiCallMessage(plan_prompt =
                `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be designed to gather a broad overview of the topic and should not focus on any one aspect too deeply. The prompts should be clear and specific, and should not require any further clarification from the user. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with "</prompt>"`
            );
            const messages_for_api: ApiCallMessage[] = [system_prompt, ...messages];

            planResult = await callOpenRouterChat(apiKey, models.reasoning, max_planning_tokens, max_planning_requests, messages_for_api);
            fetchGenerationData(apiKey, planResult.requestID).then(data => {
                if(data) {
                    total_cost += data.total_cost || 0;
                    total_web_requests += data.num_search_results || 0;
                    planResult!.generationData = data; // attach generation data to the response
                }
            });
            research_plan = planResult.content.trim();
        }

        /*****************************/
        /* Execute the research plan */
        /*****************************/
        const subquery_system_prompt = createSystemApiCallMessage(
            `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. The following prompt is designed to gather information that is relevant to a bigger question or goal and will be used to synthesize an answer to it. Your answer will be fed into another LLM, so be clear and detailed in your response. Do not worry about politeness or formalities, just provide the information requested.`
        );

        // Extract the prompts from the research_plan
        const promptRegex = /<prompt>(.*?)<\/prompt>/gs;
        const prompts: string[] = [];
        let match;
        while ((match = promptRegex.exec(research_plan)) !== null) {
            prompts.push(match[1].trim());
        }

        statusCallback(`Executing research plan with ${prompts.length} research threads.`);



        // Execute all prompts in parallel
        const perPromptWebRequests = config.deepResearchWebRequestsPerSubrequest;
        const promises = prompts.map(prompt => {
            const messages_for_subquery: ApiCallMessage[] = [
                subquery_system_prompt,
                {
                    role: 'user',
                    content: [{ type: 'text', text: prompt }]
                }
            ];
            return callOpenRouterChat(apiKey, models.researcher, maxTokens, perPromptWebRequests, messages_for_subquery);
        });

        const responses = await Promise.all(promises);

        // Collect the responses
        responses.forEach((response, index) => {
            research_threads.push({
                prompt: prompts[index],
                firstPass: response
            });
            if (response.annotations) {
                allAnnotations.push(...response.annotations);
            }
        });

        statusCallback(`Research plan executed. Fetching generation data.`);

        // Fetch generation data for each response in parallel
        const generationDataPromises = responses.map(response => 
            fetchGenerationData(apiKey, response.requestID)
        );
        const generationDatas = await Promise.all(generationDataPromises);

        // Update total_cost and total_web_requests
        for (const data of generationDatas) {
            if (data) {
                total_cost += data.total_cost || 0;
                total_web_requests += data.num_search_results || 0;
                const response = responses.find(r => r.requestID === data.id);
                if (response) {
                    response.generationData = data; // attach generation data to the response
                }
            }
        }


        /*********************/
        /* Refine the results */
        /*********************/
        statusCallback("Refining research results.");

        // Get the last user message to use as the query for refinement
        const userMessages = messages.filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];
        if (!lastUserMessage) {
            throw new Error("No user message found for refinement");
        }
        const userQuery = lastUserMessage.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n');

        // Refine each sub-result in parallel
        const refinePromises = research_threads.map(thread => 
            refine_result(apiKey, models.editor, thread, userQuery, maxTokens, 0)
        );

        const refinedResults = await Promise.all(refinePromises);

        // Update the research_threads with the refined results and collect generation data
        for (let i = 0; i < refinedResults.length; i++) {
            const result = refinedResults[i];
            // The thread.refined is already set by refine_result
            if (result.chatResult.annotations) {
                allAnnotations.push(...result.chatResult.annotations);
            }
            if (result.generationData) {
                total_cost += result.generationData.total_cost || 0;
                total_web_requests += result.generationData.num_search_results || 0;
            }
        }

        /*********************/
        /* Do the synthesis */
        /*********************/
        statusCallback("Synthesizing research results.");
        const synthesis_prompt_string = `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the results of the research plan and synthesize them into a final answer to the user's question or goal. The synthesis should be clear, concise, and should address the user's question or goal directly. The synthesis should be based on the information gathered in the previous prompts, and should not include any unnecessary or irrelevant information. Cite all sources.` + config.deepResearchSystemPrompt;
        const synthesis_system_prompt = createSystemApiCallMessage(synthesis_prompt_string);

        // Construct the messages for synthesis
        const messages_for_synthesis: ApiCallMessage[] = [
            synthesis_system_prompt,
            ...messages.filter(m => m.role !== 'system'),   // remove system messages from the original conversation
            createAssistantApiCallMessage(`Research Plan:\n${research_plan}`),
            ...research_threads.map((thread, index) => createAssistantApiCallMessage(`Research Result ${index+1} (Refined):\n${thread.refined?.content}`))
        ];

        const synthesisResponse = await callOpenRouterChat(
            apiKey,
            models.reasoning,
            config.deepResearchMaxSynthesisTokens,
            0,   // web requests
            messages_for_synthesis
        );

        statusCallback("Research synthesis complete.");
        statusCallback("Fetching synthesis generation data.");

        // Fetch the generation data for the synthesis step
        const synthesisGenerationData = await fetchGenerationData(apiKey, synthesisResponse.requestID);
        if (synthesisGenerationData) {
            total_cost += synthesisGenerationData.total_cost || 0;
            total_web_requests += synthesisGenerationData.num_search_results || 0;
            synthesisResponse.generationData = synthesisGenerationData; // attach generation data to the response
        }

        answer_content = synthesisResponse.content;
        if (synthesisResponse.annotations) {
            allAnnotations.push(...synthesisResponse.annotations);
        }

        statusCallback("Deep research completed successfully.");

        return {
            id: generateID(),
            total_cost,
            models: models,
            plan_prompt,
            plan_result: planResult!,
            research_plan,
            research_threads,
            synthesis_prompt: synthesis_prompt_string,
            synthesis_result: synthesisResponse,
            content: answer_content,
            annotations: allAnnotations
        };
}


async function determineStrategy(apiKey: string, models: ModelsForResearch, messages: ApiCallMessage[]): Promise<{ strategy: 'deep' | 'broad', chatResult: ChatResult }> {
    const system_prompt : ApiCallMessage = {
        role: 'system',
        content: [{
            type: 'text',
            text: "Analyze the user's messages (and assistant's messages if there are any) and determine the best research strategy to answer the question or achieve the goal. If the messages indicate a need for deep research, use 'deep'. If they suggest a broad overview, use 'broad'. If unsure, default to 'unsure'. Reply with only those words and no explanation.",
        }],
    };
    const messages_for_api : ApiCallMessage[] = [ system_prompt, ...messages];

    const response = await callOpenRouterChat(
        apiKey,
        models.reasoning,
        500, // maxTokens: we only need a single word
        0,  // maxWebRequests: none for this step
        messages_for_api
    );

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

export async function refine_result(
    apiKey: string,
    modelId: string,
    thread: ResearchThread,
    userQuery: string,
    maxTokens: number,
    maxWebRequests: number
): Promise<{ chatResult: ChatResult, generationData: GenerationData | undefined }> {
    const systemPrompt = createSystemApiCallMessage(
        `You are an expert researcher. Your task is to extract and summarize all information from the provided research result that is relevant to the user's original query. Only include information that is relevant or potentially relevant to the query. Omit any irrelevant information. Be dense and include all important details.`
    );

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
            text: `Research result to refine:\n${thread.firstPass?.content || ''}`
        }]
    };

    const messages: ApiCallMessage[] = [systemPrompt, userMessage, assistantMessage];

    const chatResult = await callOpenRouterChat(
        apiKey,
        modelId,
        maxTokens,
        0,
        messages
    );

    const generationData = await fetchGenerationData(apiKey, chatResult.requestID);
    if (generationData) {
        chatResult.generationData = generationData;
    }
    thread.refined = chatResult;

    return { chatResult, generationData };
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
    const planningCost = (planningInputTokens * pricingPlanning.prompt + planningOutputTokens * pricingPlanning.completion);

    // Step 3: Execution of subqueries
    const researcherModel = config.defaultModel;
    const pricingResearcher = modelPricing[researcherModel];
    const numSubqueries = config.deepResearchMaxSubqrequests;
    const perSubqueryInputTokens = 200 + config.deepResearchWebRequestsPerSubrequest*600; // system (100) + prompt (100) + estimated tokens from web searches
    const perSubqueryOutputTokens = 1000;
    const executionCost = numSubqueries * (perSubqueryInputTokens * pricingResearcher.prompt + perSubqueryOutputTokens * pricingResearcher.completion);

    // Step 4: Refinement
    const editorModel = config.defaultReasoningModel; // using reasoning model for refinement
    const pricingEditor = modelPricing[editorModel];
    const perRefinementInputTokens = 100 + 1000 + perSubqueryOutputTokens; // system (100) + user query (1000) + subquery result (1000)
    const perRefinementOutputTokens = 1000;
    const refinementCost = numSubqueries * (perRefinementInputTokens * pricingEditor.prompt + perRefinementOutputTokens * pricingEditor.completion);

    // Step 5: Synthesis
    const synthesisInputTokens = 200 + 1000 + strategyOutputTokens + (perRefinementOutputTokens * numSubqueries); // system (200) + user messages (1000)
    const synthesisOutputTokens = config.deepResearchMaxSynthesisTokens;
    const synthesisCost = (synthesisInputTokens * pricingPlanning.prompt + synthesisOutputTokens * pricingPlanning.completion);

    // Web search cost
    const webSearchCost = (config.deepResearchWebSearchMaxPlanningResults + (config.deepResearchWebRequestsPerSubrequest * numSubqueries)) * 0.004;

    // Total cost
    const totalCost = strategyCost + planningCost + executionCost + refinementCost + synthesisCost + webSearchCost;

    // Log all of the costs that went into total cost:
    console.log(`Strategy cost: $${strategyCost.toFixed(3)}`);
    console.log(`Planning cost: $${planningCost.toFixed(3)}`);
    console.log(`Execution cost: $${executionCost.toFixed(3)}`);
    console.log(`Refinement cost: $${refinementCost.toFixed(3)}`);
    console.log(`Synthesis cost: $${synthesisCost.toFixed(3)}`);
    console.log(`Web search cost: $${webSearchCost.toFixed(3)}`);
    console.log(`Estimated deep research cost: $${totalCost.toFixed(3)}`);
    return totalCost;
}
