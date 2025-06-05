import { callOpenRouterChat } from "./models";
import type { ApiCallMessage, DeepResearchResult, ApiCallMessageContent, ModelsForResearch, ChatResult } from "./types";
import { generateID } from "./util";

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

        statusCallback("Starting deep research...");


        if (strategy === 'auto') {
            statusCallback("Determining research strategy...");
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
        } else {
            actualStrategy = strategy;
        }

        // TODO: Implement the research using actualStrategy

        return {
            id: generateID(),
            total_cost,
            models: models,
            content: ""
        };
}


