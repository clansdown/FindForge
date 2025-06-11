import { callOpenRouterChat, createAssistantApiCallMessage, createSystemApiCallMessage, fetchGenerationData, getModels } from "./models";
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
    maxWebRequests : number, 
    models : ModelsForResearch,
    strategy : 'deep' | 'broad' | 'auto',
    messages : ApiCallMessage[], 
    statusCallback : (status: string) => void): Promise<DeepResearchResult> {
        const startTime = Date.now(); // Record start time for elapsed_time calculation

        function parseResourcesFromContent(content: string): Resource[] {
            const resources: Resource[] = [];
            const resourceRegex = /<RESOURCE>(.*?)<\/RESOURCE>/gs;
            let resourceMatch;
            while ((resourceMatch = resourceRegex.exec(content)) !== null) {
                const resourceBlock = resourceMatch[1];
                const urlMatch = /<URL>(.*?)<\/URL>/s.exec(resourceBlock);
                const titleMatch = /<TITLE>(.*?)<\/TITLE>/s.exec(resourceBlock);
                const authorMatch = /<AUTHOR>(.*?)<\/AUTHOR>/s.exec(resourceBlock);
                const dateMatch = /<DATE>(.*?)<\/DATE>/s.exec(resourceBlock);
                const typeMatch = /<TYPE>(.*?)<\/TYPE>/s.exec(resourceBlock);
                const purposeMatch = /<PURPOSE>(.*?)<\/PURPOSE>/s.exec(resourceBlock);
                const summaryMatch = /<SUMMARY>(.*?)<\/SUMMARY>/s.exec(resourceBlock);

                if (urlMatch && urlMatch[1]) {
                    const resource: Resource = {
                        url: urlMatch[1].trim(),
                        title: titleMatch && titleMatch[1] ? titleMatch[1].trim() : undefined,
                        author: authorMatch && authorMatch[1] ? authorMatch[1].trim() : undefined,
                        date: dateMatch && dateMatch[1] ? dateMatch[1].trim() : undefined,
                        type: typeMatch && typeMatch[1] ? typeMatch[1].trim() : undefined,
                        purpose: purposeMatch && purposeMatch[1] ? purposeMatch[1].trim() : undefined,
                        summary: summaryMatch && summaryMatch[1] ? summaryMatch[1].trim() : undefined
                    };
                    resources.push(resource);
                }
            }
            return resources;
        }

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
        let allAnnotations: Annotation[] = []; // to collect all annotations
        const max_planning_requests = config.deepResearchWebSearchMaxPlanningResults;

        statusCallback("Starting deep research.");

        /**********************************/
        /* Ensure that we have a strategy */
        /**********************************/
        if (strategy === 'auto') {
            statusCallback("Determining research strategy.");
            try {
                const { strategy: determinedStrategy, chatResult } = await determineStrategy(apiKey, models, messages, config.defaultReasoningEffort);
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

            planResult = await callOpenRouterChat(apiKey, models.reasoning, max_planning_tokens, max_planning_requests, messages_for_api, undefined, config.defaultReasoningEffort);
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
            if (planResult.annotations) {
                allAnnotations.push(...planResult.annotations);
            }
        } else if (actualStrategy === 'broad') {
            const system_prompt = createSystemApiCallMessage(plan_prompt =
                `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed into an LLM, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be designed to gather a broad overview of the topic and should not focus on any one aspect too deeply. The prompts should be clear and specific, and should not require any further clarification from the user. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with "</prompt>"`
            );
            const messages_for_api: ApiCallMessage[] = [system_prompt, ...messages];

            planResult = await callOpenRouterChat(apiKey, models.reasoning, max_planning_tokens, max_planning_requests, messages_for_api, undefined, config.defaultReasoningEffort);
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
        // Extract the prompts from the research_plan
        const promptRegex = /<prompt>(.*?)<\/prompt>/gs;
        const prompts: string[] = [];
        let match;
        while ((match = promptRegex.exec(research_plan)) !== null) {
            prompts.push(match[1].trim());
        }

        statusCallback(`Executing research plan with ${prompts.length} research threads.`);



        // Execute all prompts in parallel
        const subquery_system_prompt = createSystemApiCallMessage(
            `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. The following prompt is designed to gather information that is relevant to a bigger question or goal and will be used to synthesize an answer to it. Your answer will be fed into another LLM, so be clear and detailed in your response. Do not worry about politeness or formalities, just provide the information requested. Provide anything that may be relevant in an information dense manner. After you are done with that, add a section that begins with <RESOURCES> and ends with </RESOURCES>. Inside of the RESOURCES section, provide a list of the resources you used to gather information. Each resource should begin with <RESOURCE> and end with </RESOURCE>. The resource should begin with the URL wrapped in <URL> and </URL> tags. Include relevant information from the resource such as the title (wrapped in <TITLE> </TITLE> tags), author or authors (wrapped in <AUTHOR> </AUTHOR> tags), and date (wrapped in <DATE> </DATE> tags). Also give a description of the kind of resource it is (e.g. journal article, scientific study, personal blog post, professional blog post, corporate blog post, news article, etc.) wrapped in <TYPE> and </TYPE> tags. Indicate why the resource was written and published, especially if it is meant to persuade, educate, get business, advertise, provide SEO chum, etc. wrapped in <PURPOSE> and </PURPOSE> tags. Include a two to four sentence rich summary of the resource wrapped in <SUMMARY> and </SUMMARY> tags.`
        );
        const perPromptWebRequests = config.deepResearchWebRequestsPerSubrequest;
        const promises = prompts.map(prompt => {
            const messages_for_subquery: ApiCallMessage[] = [
                subquery_system_prompt,
                {
                    role: 'user',
                    content: [{ type: 'text', text: prompt }]
                }
            ];
            return callOpenRouterChat(apiKey, models.researcher, maxTokens, perPromptWebRequests, messages_for_subquery, undefined, config.defaultReasoningEffort);
        });

        const responses = await Promise.all(promises);

        // Parse resources from the first pass responses
        let allResources: Resource[] = [];
        for (const response of responses) {
            const resources = parseResourcesFromContent(response.content);
            allResources.push(...resources);
        }

        // Collect the responses
        responses.forEach((response, index) => {
            const thread: ResearchThread = {
                prompt: prompts[index],
                firstPass: response,
                generationPromises: [],
                handleGenerationData: (data: GenerationData) => {
                    total_cost += data.total_cost || 0;
                    total_web_requests += data.num_search_results || 0;
                    if (data.generation_time) {
                        total_generation_time_ms += data.generation_time;
                    }
                }
            };
            const promise = (async () => {
                const data = await fetchGenerationData(apiKey, response.requestID);
                response.generationData = data;
                thread.handleGenerationData(data);
                return data;
            })();
            thread.generationPromises.push(promise);
            research_threads.push(thread);
            if (response.annotations) {
                allAnnotations.push(...response.annotations);
            }
        });

        statusCallback(`Research plan executed. Fetching generation data.`);

        // We are now using generationPromises in ResearchThread
        // so we don't need to fetch generation data here


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
            refine_result(apiKey, models.editor, thread, userQuery, maxTokens, 0, config.defaultReasoningEffort)
        );

        const refinedResults = await Promise.all(refinePromises);

        // Update the research_threads with the refined results
        for (let i = 0; i < refinedResults.length; i++) {
            const result = refinedResults[i];
            // The thread.refined is already set by refine_result
            if (result.chatResult.annotations) {
                allAnnotations.push(...result.chatResult.annotations);
            }
        }

        /******************************************************/
        /* Wait for all generation data and update totals      */
        /******************************************************/
        statusCallback("Waiting for generation data...");
        // Collect all generation promises from all threads
        const allGenerationPromises: Promise<GenerationData>[] = [];
        for (const thread of research_threads) {
            allGenerationPromises.push(...thread.generationPromises);
        }
        // We don't need the results because they are attached to the chat results
        await Promise.all(allGenerationPromises);


        /*********************/
        /* Do the synthesis */
        /*********************/
        statusCallback("Synthesizing research results.");
        const synthesis_prompt_string = `You are an expert researcher and analyst. Analyze the answers to each of the research prompts from the research plan (research results) and synthesize them into an answer to the user's question or goal. Wrap any reasoning prior to the answer in <REASONING> and </REASONING> tags. Wrap the answer for the user in <ANSWER> and </ANSWER> tags. ` + config.deepResearchSystemPrompt;
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

        statusCallback("Deep research completed successfully.");

        const elapsed_time = (Date.now() - startTime) / 1000; // in seconds

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
            annotations: allAnnotations,
            resources: allResources,
            total_generation_time: total_generation_time_ms / 1000, // convert to seconds
            elapsed_time,
            contextWasIncluded: true
        };
}


async function determineStrategy(apiKey: string, models: ModelsForResearch, messages: ApiCallMessage[], reasoningEffort: 'low'|'medium'|'high'): Promise<{ strategy: 'deep' | 'broad', chatResult: ChatResult }> {
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

export async function refine_result(
    apiKey: string,
    modelId: string,
    thread: ResearchThread,
    userQuery: string,
    maxTokens: number,
    maxWebRequests: number,
    reasoningEffort: 'low' | 'medium' | 'high'
): Promise<{ chatResult: ChatResult, generationData: GenerationData | undefined }> {
    const system_prompt_string =
        `You are an expert researcher. Your task is to extract and summarize all information from the provided research result that is relevant to the user's original query. Only include information that is relevant or potentially relevant to the query. Omit any irrelevant information. Be dense and include all important details. Your output will be fed into a reasoning model for synthesis. Do not worry about politeness or formalities. The original research result is provided below.`;
    thread.refiningPrompt = system_prompt_string;
    const systemPrompt = createSystemApiCallMessage(system_prompt_string);

    // Strip out the RESOURCES section from the content to refine
    let contentToRefine = thread.firstPass?.content || '';
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

    const chatResult = await callOpenRouterChat(
        apiKey,
        modelId,
        maxTokens,
        0,
        messages,
        undefined,
        reasoningEffort
    );

    thread.refined = chatResult;
    const genPromise = (async () => {
        const data = await fetchGenerationData(apiKey, chatResult.requestID);
        if (data) {
            chatResult.generationData = data;
            thread.handleGenerationData(data);
        }
        return data;
    })();
    thread.generationPromises.push(genPromise);
    return { chatResult, generationData: undefined };
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
    const perSubqueryInputTokens = 200 + config.deepResearchWebRequestsPerSubrequest*600; // system (100) + prompt (100)
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
