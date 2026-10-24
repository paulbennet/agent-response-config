We are going to work on creating an agent skill -- Applicable to claude, codex, github copilot first -- Adaptable to other agents if needed later.

For claude we can further wrap the skill into a plugin if needed.

What the skill is for ?
Agents (coding or other) -- most ones as per their training or system instructions -- when interacted upon have the habit of responding with huge conversational responses to human/user in the intention of helping out with more info.

But this exploded conversation responses are not usually helpful all the time. Users have to read through big prose content everytime to scan what the agent has done in the previous task. Sometimes important caveats and next step questions agents provide are buried in the huge text, humans miss them very easily.

To address this .. our skill will help in following ..

1. Very-minimal/compressed/non-verbose - response texts

- Response prose content (conversational, info, etc) should be reduced very much.
- Artefacts or snippets in the response such as code blocks, commands, sample content, etc .. can be retained as is. As reducing them might break things.
- Very-minimal/compressed/non-verbose will be configurable to turn on/off for the skill.
- If turned on, the amount of reduction, artefact exclusion/inclusion will all be configurable for the skill.

2. Structured and actionable - response texts

- Responses should be organized as minimal summary response from point above, followed by next actions, suggestions, questions & decisions.
- In a continuous agent session, the actions, suggestions, questions, decisions should be tracked and numbered uniquely per actionable type for reference and easy follow-up.
- Users will be able to do quick reply to specific actions, suggestions, questions, or decisions by referencing their unique numbers.
- Structured response will be configurable to turn on/off for the skill.

3. Levels of the language usage - response texts

- This part only concerns English language usage in response texts (for now)
- Refer @english-levels-research.md for detailed English proficiency levels, readability formulas, controlled vocabularies, word-frequency lists, and plain language guidelines. This is for your reference and planning.
- Users will be able to specify the desired English proficiency level, readability standard, controlled vocabulary, word-frequency list, and plain language guidelines for the response texts.
- Levels of the language usage will be configurable to turn on/off for the skill.
- Users will be able to specify the desired level for each aspect (proficiency, readability, vocabulary, word-frequency, plain language) individually.

--

Additionally, this skill will also help setup several hooks for agents (claude, codex, github copilot) to enforce the above configurations and ensure that the responses adhere to the specified minimal verbosity, structured format, and language usage levels.

- Session start hooks - Initialize the agent with the current skill configurations and expected response format.
- Each prompt hook - Hint agent about the current skill configurations and expected response format.
- This is opt-in during the skill/plugin setup. Agent itself should be able to setup/configure this for users as well anytime.

--

Additionally, for Claude alone, using the recent claude code mods feature, we will allow users to setup this whole configurations using a quirky and interactive interface.

--

- Skill/plugin should be installable via skills.sh
- Suggest any other better standard skill sharing platforms or methods.
