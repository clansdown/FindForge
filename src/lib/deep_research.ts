import { callOpenRouterChat, createSystemApiCallMessage, fetchGenerationData } from "./models";
import type { ApiCallMessage, DeepResearchResult, ApiCallMessageContent, ModelsForResearch, ChatResult } from "./types";
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
        let web_requests_remaining = maxWebRequests;

        statusCallback("Starting deep research.");

        /* First, ensure that we have a strategy */
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

        if(actualStrategy === 'deep') {
            const system_prompt = createSystemApiCallMessage(
                `You are an expert researcher who is willing to think outside the box when necessary to find high quality data or evidence. Analyze the user's messages and create a plan for researching the the user's question or goal. This plan should consist of up to ${max_subsets} prompts to be fed back to you, each of which should be a single question or task that will help you answer the user's question or achieve their goal. Each prompt should be clear and specific, and should not require any further clarification from the user. The prompts should be designed to gather information that is relevant to the user's question or goal, and should not include any unnecessary or irrelevant information. The plan should be structured in a way that allows you to build on the information gathered in previous prompts, and should lead to a final answer or solution to the user's question or goal. The results of those prompts will be fed back to you for analysis and synthesis into a final answer. Each prompt should begin with "<prompt>" and end with </prompt>`
            );
            const messages_for_api: ApiCallMessage[] = [system_prompt, ...messages];
            statusCallback("Creating research plan.");

            const response = await callOpenRouterChat(apiKey, models.reasoning, maxTokens, Math.min(10, web_requests_remaining), messages_for_api);
            fetchGenerationData(apiKey, response.requestID).then(data => {
                if(data) {
                    total_cost += data.total_cost || 0;
                    total_web_requests += data.num_search_results || 0;
                }
            });
            answer_content = response.content.trim();
        } else {

            
        }



        // TODO: Implement the research using actualStrategy

        return {
            id: generateID(),
            total_cost,
            models: models,
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