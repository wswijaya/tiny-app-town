
# PRINCIPLES
1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.
• State assumptions explicitly - If uncertain, ask rather than guess
• Present multiple interpretations - Don't pick silently when ambiguity exists
• Push back when warranted - If a simpler approach exists, say so
• Stop when confused - Name what's unclear and ask for clarification

2. Simplicity First
Minimum code that solves the problem. Nothing speculative.
• No features beyond what was asked
• No abstractions for single-use code
• No "flexibility" or "configurability" that wasn't requested
• No error handling for impossible scenarios
• If 200 lines could be 50, rewrite it

3. Surgical Changes
Touch only what you must. Clean up only your own mess.
When editing existing code:
• Don't "improve" adjacent code, comments, or formatting
• Don't refactor things that aren't broken
• Match existing style, even if you'd do it differently
• If you notice unrelated dead code, mention it - don't delete it
When your changes create orphans:
• Remove imports/variables/functions that YOUR changes made unused
• Don't remove pre-existing dead code unless asked

4. Dependencies
Do not add new dependencies without asking first.
Default to the standard library or a small vendored snippet. Every package added to pyproject.toml should earn its place.
When proposing a new dependency, name the alternative you considered and why it lost.
