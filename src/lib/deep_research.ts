import { callOpenRouterChat, createAssistantApiCallMessage, createSystemApiCallMessage, fetchGenerationData } from "./models";
import type { ApiCallMessage, DeepResearchResult, ApiCallMessageContent, ModelsForResearch, ChatResult, GenerationData } from "./types";
import { generateID } from "./util";



export async function doDeepResearch(
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
        let max_subsets = Math.max(2, (maxWebRequests / 10)-1);
        const web_requests = () => { return Math.max(0, maxWebRequests - total_web_requests); };
        let plan_prompt : string = '';
        let sub_results : string[] = [];

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
        if(actualStrategy === 'deep') {
            const system_prompt = createSystemApiCallMessage(plan_prompt =
                `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed back to you, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be clear and specific, and should not require any further clarification from the user. The prompts should be designed to gather information that is relevant to the user's question or goal, and should not include any unnecessary or irrelevant information. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question or goal. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with </prompt>`
            );
            const messages_for_api: ApiCallMessage[] = [system_prompt, ...messages];

            const response = await callOpenRouterChat(apiKey, models.reasoning, maxTokens, web_requests(), messages_for_api);
            fetchGenerationData(apiKey, response.requestID).then(data => {
                if(data) {
                    total_cost += data.total_cost || 0;
                    total_web_requests += data.num_search_results || 0;
                }
            });
            research_plan = response.content.trim();
        } else if (actualStrategy === 'broad') {
            const system_prompt = createSystemApiCallMessage(plan_prompt =
                `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed back to you, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be designed to gather a broad overview of the topic and should not focus on any one aspect too deeply. The prompts should be clear and specific, and should not require any further clarification from the user. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with "</prompt>"`
            );
            const messages_for_api: ApiCallMessage[] = [system_prompt, ...messages];

            const response = await callOpenRouterChat(apiKey, models.reasoning, maxTokens, web_requests(), messages_for_api);
            fetchGenerationData(apiKey, response.requestID).then(data => {
                if(data) {
                    total_cost += data.total_cost || 0;
                    total_web_requests += data.num_search_results || 0;
                }
            });
            research_plan = response.content.trim();
        }

        /*****************************/
        /* Execute the research plan */
        /*****************************/
        const subquery_system_prompt = createSystemApiCallMessage(
            `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. `
        );

        // Extract the prompts from the research_plan
        const promptRegex = /<prompt>(.*?)<\/prompt>/gs;
        const prompts: string[] = [];
        let match;
        while ((match = promptRegex.exec(research_plan)) !== null) {
            prompts.push(match[1].trim());
        }

        statusCallback(`Executing research plan: ${prompts.length} prompts in parallel.`);

        // Calculate the remaining web requests and allocate per prompt
        const remaining = web_requests();
        const perPromptWebRequests = prompts.length > 0 ? Math.max(0, Math.floor(remaining / prompts.length)) : 0;

        // Execute all prompts in parallel
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
        responses.forEach(response => {
            sub_results.push(response.content);
        });

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
            }
        }

        /*********************/
        /* Get the synthesis */
        /*********************/
        const synthesis_system_prompt = createSystemApiCallMessage(
            `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the results of the research plan and synthesize them into a final answer to the user's question or goal. The synthesis should be clear, concise, and should address the user's question or goal directly. The synthesis should be based on the information gathered in the previous prompts, and should not include any unnecessary or irrelevant information. Cite all sources.`
        );
        // TODO: allow the user to supply text to be added on to the synthesis prompt like the regular system prompt.

        /*********************/
        /* Do the synthesis */
        /*********************/
        statusCallback("Synthesizing research results.");

        // Construct the messages for synthesis
        const messages_for_synthesis: ApiCallMessage[] = [
            synthesis_system_prompt,
            ...messages.filter(m => m.role !== 'system'),   // remove system messages from the original conversation
            createAssistantApiCallMessage(`Research Plan:\n${research_plan}`),
            ...sub_results.map((result, index) => createAssistantApiCallMessage(`Research Result ${index+1}:\n${result}`))
        ];

        const synthesisResponse = await callOpenRouterChat(
            apiKey,
            models.reasoning,
            maxTokens,
            web_requests(),   // use the remaining web requests
            messages_for_synthesis
        );

        // Fetch the generation data for the synthesis step
        const synthesisGenerationData = await fetchGenerationData(apiKey, synthesisResponse.requestID);
        if (synthesisGenerationData) {
            total_cost += synthesisGenerationData.total_cost || 0;
            total_web_requests += synthesisGenerationData.num_search_results || 0;
        }

        answer_content = synthesisResponse.content;

        statusCallback("Research synthesis complete.");

        return {
            id: generateID(),
            total_cost,
            models: models,
            plan_prompt,
            research_plan,
            sub_results,
            content: answer_content
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
        10, // maxTokens: we only need a single word
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
    subQueryContent: string,
    userQuery: string,
    maxTokens: number,
    maxWebRequests: number,
    abortController?: AbortController
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
            text: `Research result to refine:\n${subQueryContent}`
        }]
    };

    const messages: ApiCallMessage[] = [systemPrompt, userMessage, assistantMessage];

    const chatResult = await callOpenRouterChat(
        apiKey,
        modelId,
        maxTokens,
        maxWebRequests,
        messages,
        abortController
    );

    const generationData = await fetchGenerationData(apiKey, chatResult.requestID);

    return { chatResult, generationData };
}
