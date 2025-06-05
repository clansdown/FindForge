import { callOpenRouterChat } from "./models";
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

        statusCallback("Starting deep research...");


        if (strategy === 'auto') {
            statusCallback("Determining research strategy...");
            const system_prompt : ApiCallMessage = {
                role: 'system',
                content: [{
                    type: 'text',
                    text: "Analyze the user's messages (and assistant's messages if there are any) and determine the best research strategy to answer the question or achieve the goal. If the messages indicate a need for deep research, use 'deep'. If they suggest a broad overview, use 'broad'. If unsure, default to 'unsure'. Reply with only those words and no explanation.",
                }],
            };
            const messages_for_api : ApiCallMessage[] = [ system_prompt, ...messages];

            try {
                const response = await callOpenRouterChat(
                    apiKey,
                    models.reasoning,
                    10, // maxTokens: we only need a single word
                    0,  // maxWebRequests: none for this step
                    messages_for_api
                );
                chat_results.push(response);

                const strategyResponse = response.content.trim().toLowerCase();
                console.log('Strategy response:', strategyResponse);
                if (strategyResponse === 'deep' || strategyResponse === 'broad') {
                    actualStrategy = strategyResponse;
                } else {
                    // try regexes 
                    const deepRegex = /deep/i;
                    const broadRegex = /broad/i;
                    if (deepRegex.test(strategyResponse)) {
                        actualStrategy = 'deep';
                    } else if (broadRegex.test(strategyResponse)) {
                        actualStrategy = 'broad';
                    } else {
                        // It doesn't matter if it actually is 'unsure', we will default to deep anyway
                        actualStrategy = 'deep';
                    }
                }
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


