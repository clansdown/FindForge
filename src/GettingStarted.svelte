<script lang="ts">

</script>

<div class="text">

<p>There's a lot of hype about AI, but in spite of that it can actually be a very useful research tool. To explain how to use this research tool well, we've got to take a quick detour in explaining how the underlying AI works. To do that, let's start with calling it by its proper name: LLMs, or Large Language Models.</p>

<p></p>

<h2>What LLMs are good at.</h2>

<p>LLMs are created by a "training" process where a model is constructed through analyzing terabytes of data for the patterns in it. Once trained, LLMs are good at reproducing the patterns that exist in their training data. Up until this time, computers were limited to searching for words and phrases;  the combinatorics of word patterns are where the immense power of LLMs come from.</p>

<p>Now, when I say patterns, I don't mean patterns of specific words. If you have enough training data, "tip the waiter," "give money to the food server," and "pay the guy who brought you your food" have the same underlying pattern. (Because of all the other patterns in the training data which make tip in the verb part of a sentence show up with the same kind of places as "give money to". This is why the training data needs to be so immense.)</p>

<p>And this is why LLMs are able to generate text which reads as an answer to a question: patterns of question and answer showed up in its training data. So when you begin the pattern, "What is the moon made of?" the LLM will find the rest of the pattern: "The Moon is made of rock."</p>

<p>But here's the thing: the patterns an LLM can find are limited to the patterns that existed in its training data. If the training data contained ten thousand variants of "the Moon is made of cheese" and no variants of "the Moon is made of rock," then when you start a pattern with "What is the Moon made of?" it will find the pattern "The Moon is made of cheese" and complete your pattern with great confidence. A variation of this is called "hallucination"—when an LLM makes up names and facts that aren't real. This is really just a textual variation of an optical illusion: this is the pattern that exists in its training data, so it's what it gives you. It's got no concept of truth, or a world existing outside itself to which words are referring. It's just a giant collection of numbers that embed patterns in the training data.</p>

<h2>Making Up For Deficiencies in the Training Data</h2>

<p>An enormously powerful tool was added to most LLMs in 2024: the ability of the LLM to "request" a web search or web page from the code that is running it. (Under the hood it is just instructions in the input data to the model that trigger useful patterns, but I'll stick with the anthropomorphic language for brevity.) It is simply not practical to train LLMs on all of the possible resources, and even less practical to reinforce only the good ones. This iss why early LLMs like the first chatGPT were cute party tricks but barely useful for anything. But LLMs' pattern search ability makes them great at doing things like summarizing blocks of text or extracting the parts of a document that are relevant to a question.</p>

<p>By adding the ability for LLMs to perform web searches to retrieve web pages and make them part of the query, the utility of LLMs grew tremendously. Web pages exist because someone thought the information was worth writing down and collecting it in one place; this encodes tremendous amounts of data about what facts are relevant to each other for some purpose. The LLM doesn't understand that, but by happy coincidence all of that which the human mind understands gets encoded into the word patterns we use to communicate, so the LLM can extract those.</p>

<p>(The ability to search is actually just one aspect of the more general approach called "Tool Calling," where the LLM is instructed to produce formatted output that the code running the model then interprets. For example, the LLM might output <span class="quote">&lbrace;"tool": "calculate", "expression": "2 + 2"&rbrace;</span> which the code running it extracts, executes the mathematical operation, and replaces the original with the computation. This has also greatly improved the power of LLMs because their output can come from the combined power of pattern-based text generation <i>and</i> traditional computation.)</p>

<h2>So How Do You Use This for Research?</h2>

<p>The key to using LLMs for research is to remember that they are powerful search engines for patterns in their training data augmented by the ability to execute traditional computational approaches including web searches. So this comes down to a few key points:</p>

<h4>1. Ask Questions People Have Answered</h4>

<p>You will find the most success if you use the LLM to find patterns that actually exist in its training data. Or to put it more simply: stick to asking questions that you think have already been answered. It's even better if these answers would be in places the people training the LLM were likely to have found. That last part isn't necessary, though, because of web search. Which brings us to:</p>

<h4>2. Use This Tool as a Starting Point</h4>

<p>As I mentioned, LLMs became really useful for research when they gained the power of web search. Because of their extensive training data largely coming from the web, they are often quite good at producing search queries that find useful web pages. Even better, they can "read" through an entire web page in seconds and so they can evaluate all of the web pages the search results returns (up to a limit you set for cost reasons) and extract the relevant parts, <i>if any</i>. And they can cite their sources.</p>

<p>This can save you a huge amount of time over doing traditional text searches then skimming the results for a page to read then skimming the page to see if it's actually got what you want. But if you really want to learn about the subject you're interested in, once the LLM gives you can overview with citations, go read those pages. That's when you'll really start learning about the subject.</p>

<h4>3. LLMs Are Just as Happy When They're Wrong</h4>

<p>The thing about LLMs just being text-generators that reproduce patterns in their training data and input data is that, have no concept of truth, intellect, or emotions, they don't care in the slightest if they're wrong. Just as a power saw is equally happy to cut your fingers off as it is to cut a 2x4, an LLM is simply a machine that does what it does, for better and for worse. They happen to produce human-sounding text, which can lull you into a false sense of security, just like running 100 narrow boards through a table saw with no mishaps can lull you into a false sense of security. Just as you should always use a push-stick with a table saw, always remember that LLMs are just as good at being wrong as they are at being right.</p>

<p>So always double-check everything you learn from LLM output against sources that were written by people who are trying to be correct. (But don't forget that people can be mistaken or lie.)</p>

<h4>4. Deep Research Mode</h4>

<p>MachineLearner has a Deep Research mode (you activate it with the button with the pick icon, meant to suggest mining deep) which uses multiple steps to find more information and produce a more useful answer. Deep Research mode uses the LLM to create a research plan, then it executes the research plan in parallel research threads, then it takes the results of those threads and synthesizes an answer. (This takes longer and costs significantly more, of course, since it uses so many more LLM queries and web searches.)</p>

<h4>5. There Are More Tools in MachineLearner Than Just the Answer</h4>

<p>There are many useful settings (File→Settings) to control MachineLearner. Of particular note is that the system prompts given to the LLM telling it what to do are configurable (except for some hard-coded bits that have to do with formatting answers so MachineLearner can extract portions of them). This allows you to fine-tune your research style to whatever suits your needs. You can also control web searching and the number of results to control costs. And of course you can select the models you want to use. You can also temporarily override many of these values for a particular query.</p>

<p>In a message from the LLM, if you select a range of text a quick toolbar will pop up underneath it that makes it easy to ask the LLM about the text, search Wikipedia for the text, and do a web search for the text (preferred search engine is settable in Settings.)</p>

<p>Messages from the LLMs have several buttons at the top, next to the LLM name, which give you easy access to information about the web searches used as sources and also about the generation itself. This is especially helpful in Deep Research mode, which can easily generate fifty or more web requests, most of which are not mentioned in the answer but which may still be interesting to read. The Resources section uses the power of the LLM to describe each web page in ways that are helpful for deciding if it's worth clicking the link.</p>

<p></p>

</div>

<style>

.text {
    line-height: 1.6;
    max-width: 40rem;
    margin: auto;
    font-family: Inter, Roboto, "Open Sans";
    padding-bottom: 5rem;
}

p {
    text-align: justify;
}

span.quote {
    font-style: italic;
    color: #c99;
}

</style>