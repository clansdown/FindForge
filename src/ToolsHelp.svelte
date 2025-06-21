<script lang="ts">

</script>


<div class="main">
    <h2>System Prompts</h2>
    
    <p>System prompts define how the AI behaves and responds. They influence the style, tone, and depth of responses. This is also one of the primary ways that commercial AI chat interfaces try to prevent you from "misusing" them by telling the LLM to lecture you about seeking proper medical advice or what have you.</p>
    
    <ul>
        <li><strong>Standard Prompts</strong> - Control the AI's default conversation behavior (shown in main dropdown)</li>
        <li><strong>Synthesis Prompts</strong> - Define how Deep Research compiles and presents its findings</li>
        <li><strong>Default Prompt</strong> - Basic helpful assistant behavior with academic citations</li>
    </ul>
    
    <p>Tips for effective prompts:</p>
    <ul>
        <li>Be clear about desired tone (professional, casual, academic)</li>
        <li>Specify citation and formatting preferences</li>
        <li>Define response length expectations</li>
        <li>State any domain expertise requirements</li>
    </ul>


    <h2>Standard Research</h2>

    <p>Standard Research is the default mode of operation. It uses a single LLM to answer your questions, optionally using web results and context from the conversation history. It uses the LLM in streaming mode, so you can see the response being generated a word at a time, with the option to stop the generation if it's clearly headed in the wrong direction.</p>

    <p>Including previous messages as context uses more tokens with costs more money if you are not using a free model and, for longs "conversations", strains a model's "attention window" making it more likely to search for the wrong patterns. For shorter "conversations" it can be very useful by allowing you to briefly refer to something already mentioned, either in your text or the LLM's text.</p>

    <h2>Web Results</h2>

    <p>Web Results are an important component of using LLMs for research because they not only contain up-to-date information, but contain it written, or at least edited, by an actual intelligence. Unlike the low-end LLMs used by search engines to summarize pages, more powerful LLMs do a good job reproducing the actual information found in web pages, and selecting the relevant parts. Also important is that LLMs are good at producing useful search queries and taking multiple pages returned from them and searching through for the relevant word patterns.</p>

    <p>The only real downside is that web results cost money; someone has to maintain the search engine which answers the LLMs' queries and this cannot be ad-supported since only machines see the results. At the time of writing, search results cost $.004/result, which is quite cheap for standard research. (It can add up on deep research; see below.)</p>

    <p>Web results are not just about feeding information to the LLM, though. They are (or can be) used for citations in the LLM's generated text and are also available as a list with useful information about each link (click on the globe icon next to the LLM name in the message). Moreover, you can get a list of all web results that were used in an entire conversation from the globe icon next to the conversation title. These can be excellent resources for further investigation into the subject.</p>


    <h2>Deep Research</h2>
    
    <p>Deep Research performs multi-phase, thorough investigation of complex questions. Each phase consists of:</p>
    invoking an LLM to define a number of research prompts, then, for each prompt, invoking an LLM to generate an answer, including using web search, refining the answer in light of the user question, then invoking an LLM on the question and refined results to synthesizing the results into an answer to the user. Each phase consists of several steps:
    <ol>
        <li>Invoking the LLM to generate research prompts to gather information which might be helpful to answering the question or, on phases 2+, improving the previous answer.</li>
        <li>For each prompt, invoking an LLM to generate an answer to this prompt</li>
        <li>For each answer, an LLM is invoked with the answer, the prompt, and the user question, and the answer is refined to only include what is relevant to the user's question</li>
        <li>An LLM is invoked with the user's question and the refined research results, and on phases 2+ the previous answer, to synthesize them into an answer to the question.</li>
    </ol> 
    
    <p>The research and refinement steps are invoked in parallel. These parallel invocations of LLMs are called "research threads."</p>

    <p>There are several parameters to deep research which you can control for each question:</p>

    <ul>
        <li><strong>Research Strategy</strong>:
            <ul>
                <li><strong>Deep</strong> - Focused, detailed investigation of specific aspects</li>
                <li><strong>Broad</strong> - Wider overview of multiple related topics</li>
                <li><strong>Auto</strong> - The LLM will be invoked to guess based on your prompt</li>
            </ul>
        </li>
        <li><strong>Phases</strong> - The number of phases to use. More phases take more time and use more LLM resources, but at least for 1-3 phases, more phases tend to produce better results.</li>
        <li><strong>Research Threads</strong> - The number of prompts that a phase is permitted to generate. The answers to these will be generated in parallel, so more research threads consume more LLM time (and thus cost more money) but don't tend to make the research take substantially longer.</li>
        <li><strong>Web Requests</strong> - The number of web requests each research thread is permitted to use to generate its research result. Until you overwhelm the LLM's "attention" window (this varies with the LLM, but most will start to fall off after about 10), more web requests tend to produce better results, but (at the time of writing) each web request costs $.004 so this very directly scales the cost of research.</li>
    </ul>

    <p>In Settings, you can select the LLM used for each step of deep research to get what you find to be the best results (or the best results at prices you're willing to pay).</p>

    <p>Note: Deep Research cannot be used at the same time as Experiment Mode.</p>

    <h2>Experimentation Options</h2>
    
    <p>Experiment Mode allows you to run experiments to help figure out which models work best for you, or to refine your system prompts. Right now, the only experimentation feature is parallel research.</p>

    <h3>Parallel Research</h3>
    
    <p>This will run a standard research query with multiple models, multiple system prompts, or both. Each combination of model and system prompt will be run (so you must have at least one of each), and you will be able to compare the answers by selecting them from a dropdown in the message answer.</p>


    <p>Note: Experiment Mode cannot be used at the same time as Deep Research. Each experiment will use your current web search and context settings.</p>


</div>



<style>
    .main {
        padding: 1rem;
    }

</style>
