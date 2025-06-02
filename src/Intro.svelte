<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>

<div class="intro">
  <h1>Welcome to MachineLearner</h1>

  <p>MachineLearner is a Large Language Model (LLM) based research tool. It harnesses the power of LLMs together with 
    integrated web search that the LLMs can perform with a server-side search service in order to make research much faster.
    The integrated search not only allows the LLM to look up the latest information from the web, but more importantly to 
    cite this with links to the sources so you can verify the information yourself. After all, LLMs are powerful, but they're just
    statistical text generators and when you roll the dice, sometimes you get snake eyes.
  </p>

  <p>MachineLearner is a purely client-side application that runs in your browser and uses local storage to save your settings 
    and history. Your data lives on your computer, not on a server. This means you can use it offline, and you can be sure that 
    your data is private. This also enables providing MachineLearner for free, as there are (approximately) no server costs involved.
    The only downside is that you can't share your history between devices.
  </p>

  <p> While serving static files is nearly free on modern computers on the modern internet, it is, unfortunately, quite different for 
    running LLMs and web search services. Those cost quite a lot of money to run. Since MachineLearner is a free open source project, 
    it doesn't do any of that itself. Instead, it uses OpenRouter.ai to provide those services services. Accordingly, you'll need an 
    OpenRouter API key to use it.</p>
    <p>OpenRouter is a broker for various LLMs and web search services,
    allowing you to choose from a variety of models and capabilities. While most models and all web searches cost money, the good news
    is that there are many free models available and web search doesn't cost much. There are also many inexpensive paid models if you
    don't want your sessions saved by the model provider and used as training data. Even if you use a paid model, with a cheap but good 
    model like <i>DeepSeek V3</i>, you can do a lot of research for less than $10 per month. As in all things, your mileage may vary and
    the only guarantees in this life are death and taxes. (In other words, this is not any kind of promise or guarantee of cost, 
    just a reasonable guess based on my experience.)
  </p>

  <p>
    You can get your API key from the <a href="https://openrouter.ai/keys" target="_blank">OpenRouter dashboard</a>.
  </p>
  <button on:click={() => dispatch('openSettings')}>Open Settings to Add API Key</button>
</div>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    align-items: left;
    justify-content: justify;
    height: 100%;
    padding: 2rem;
    text-align: center;
    max-width: 860px;
    margin: auto;
  }
  
  h1 {
    margin-bottom: 1.5rem;
  }
  
  p {
    margin-bottom: 1rem;
    text-justify: inter-word;
    text-align: justify;
  }
  
  ul {
    text-align: left;
    margin-bottom: 1.5rem;
  }
  
  button {
    padding: 0.75rem 1.5rem;
    background-color: #646cff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: background-color 0.3s;
  }
  
  button:hover {
    background-color: #535bf2;
  }
</style>
