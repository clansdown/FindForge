<script lang="ts">

</script>


<div class="main">

    <h2>Standard Research</h2>

    <p>Standard Research is the default mode of operation. It uses a single LLM to answer your questions, optionally using web results and context from the conversation history. It uses the LLM in streaming mode, so you can see the response being generated a word at a time, with the option to stop the generation if it's clearly headed in the wrong direction.</p>

    <p>Including previous messages as context uses more tokens with costs more money if you are not using a free model and, for longs "conversations", strains a model's "attention window" making it more likely to search for the wrong patterns. For shorter "conversations" it can be very useful by allowing you to briefly refer to something already mentioned, either in your text or the LLM's text.</p>

    <h2>Web Results</h2>

    <p>Web Results are an important component of using LLMs for research because they not only contain up-to-date information, but contain it written, or at least edited, by an actual intelligence. Unlike the low-end LLMs used by search engines to summarize pages, more powerful LLMs do a good job reproducing the actual information found in web pages, and selecting the relevant parts. Also important is that LLMs are good at producing useful search queries and taking multiple pages returned from them and searching through for the relevant word patterns.</p>

    <p>The only real downside is that web results cost money; someone has to maintain the search engine which answers the LLMs' queries and this cannot be ad-supported since only machines see the results. At the time of writing, search results cost $.004/result, which is quite cheap for standard research. (It can add up on deep research; see below.)</p>

    <p>Web results are not just about feeding information to the LLM, though. They are (or can be) used for citations in the LLM's generated text and are also available as a list with useful information about each link (click on the globe icon next to the LLM name in the message). Moreover, you can get a list of all web results that were used in an entire conversation from the globe icon next to the conversation title. These can be excellent resources for further investigation into the subject.</p>

    <h2>System Prompts</h2>
    
    <p>System prompts define how the AI behaves and responds. They influence the style, tone, and depth of responses:</p>
    
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

    <h2>Deep Research</h2>
    
    <p>Deep Research performs multi-phase, thorough investigation of complex questions:</p>
    
    <ul>
        <li><strong>Research Strategy</strong>:
            <ul>
                <li><strong>Auto</strong> - Let the AI choose between deep or broad research</li>
                <li><strong>Deep</strong> - Focused, detailed investigation of specific aspects</li>
                <li><strong>Broad</strong> - Wider overview of multiple related topics</li>
            </ul>
        </li>
        <li><strong>Phases</strong> - Multiple iterative research cycles (1-3) to refine results</li>
        <li><strong>Research Threads</strong> - Parallel sub-queries (1-16) to explore different angles</li>
        <li><strong>Web Requests</strong> - Each thread can make multiple web searches (1-32)</li>
        <li><strong>Synthesis</strong> - Automated compilation and refinement of results</li>
    </ul>

    <p>Deep Research uses more computing resources but produces more thorough, well-sourced answers.</p>
    <p>Note: Deep Research cannot be used at the same time as Experiment Mode.</p>

    <h2>Experimentation Options</h2>
    
    <p>Experiment Mode allows you to compare different configurations in parallel:</p>
    
    <ul>
        <li><strong>Parallel Research</strong> - When enabled, runs multiple research requests simultaneously using different combinations of system prompts and models</li>
        <li><strong>System Prompts</strong> - Select multiple prompts to test how they affect the results</li>
        <li><strong>Models</strong> - Compare output from different LLMs side by side</li>
    </ul>

    <p>Note: Experiment Mode cannot be used at the same time as Deep Research. Each experiment will use your current web search and context settings.</p>


</div>



<style>
    .main {
        padding: 1rem;
    }

</style>
