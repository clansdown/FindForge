import type { DeepResearchResult, ModelsForResearch } from "./types";
import { generateID } from "./util";

export async function doDeepResearch(
    apiKey : string, 
    maxTokens : number, 
    maxWebRequests : number, 
    messages : string[], 
    models : ModelsForResearch,
    statusCallback : (status: string) => void): Promise<DeepResearchResult> {
        let total_cost = 0;
        let total_web_requests = 0;

        statusCallback("Starting deep research...");

        








        return {
            id: generateID(),
            total_cost,
            models: models,
            content: ""
        };
}


