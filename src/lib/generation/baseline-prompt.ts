export const CHARACTER_BASELINE_PROMPT = `### CHARACTER REPLACEMENT — NOT CHARACTER PRESERVATION

The original people in the source video are being **replaced**.

Do NOT preserve the original person's visual identity, face, body, hair, clothing, or other identifying appearance.

Instead, replace each original source character with their assigned supplied character reference.

However, preserve the **original character's performance** exactly, including:

* Position
* Movement
* Body motion
* Gestures
* Facial motion
* Head movement
* Eye movement
* Mouth movement
* Lip-sync
* Timing
* Interaction with objects
* Interaction with other characters

### STRICT 1:1 REPLACEMENT

Every unique person in the source video must correspond to exactly ONE supplied character reference.

For example:

**Source Person 1 → @CHARACTER_1**
**Source Person 2 → @CHARACTER_2**
**Source Person 3 → @CHARACTER_3**

The original Source Person 1 is visually replaced by @CHARACTER_1.

The original Source Person 2 is visually replaced by @CHARACTER_2.

The original Source Person 3 is visually replaced by @CHARACTER_3.

The original people must NOT remain visible as their original identities.

### CHARACTER COUNT MUST NOT CHANGE

The number of people in the output must be exactly the same as the number of people in the source video.

If the source video contains 3 people, the output must contain exactly 3 people.

If the source video contains 5 people, the output must contain exactly 5 people.

Therefore:

* Never remove a source person without replacing them.
* Never create an additional person.
* Never duplicate a replacement character.
* Never merge two source people into one person.
* Never split one source person into multiple people.
* Never use one supplied character reference for multiple source people.

### ONE REFERENCE = ONE PERSON

Each supplied \`@CHARACTER\` reference represents exactly ONE individual.

A supplied character reference must never be duplicated in the output.

For example, if:

Source Person 1 → @CHARACTER_1

then @CHARACTER_1 can ONLY represent Source Person 1.

It cannot also represent Source Person 2, a background person, a duplicate, a clone, or any other person.

### NEVER BLEND REFERENCES

Do not combine character references.

For example:

\`@CHARACTER_1 + @CHARACTER_2 = INVALID\`

Do not create a person using the face from one reference and the body, hair, clothing, facial features, or other characteristics from another reference.

Each output person must derive their identity from **one and only one** supplied character reference.

### PERMANENT IDENTITY MAPPING

Once a source person has been assigned a character reference, that assignment is permanent for the entire video.

If:

**Source Person 1 → @CHARACTER_1**

then every appearance of Source Person 1 throughout the entire video must remain @CHARACTER_1.

This remains true across:

* Different shots
* Different camera angles
* Close-ups
* Wide shots
* Side profiles
* Rear views
* Different lighting
* Occlusion
* Scene changes
* Different poses
* Different parts of the video

Never switch identities between shots.

### SOURCE VIDEO IS THE PERFORMANCE MASTER

The source video determines:

**WHO IS WHERE + WHAT THEY DO + WHEN THEY DO IT**

The supplied references determine:

**WHO THEY BECOME**

Therefore:

**SOURCE VIDEO → movement, performance, position, timing, framing and composition**

**CHARACTER REFERENCE → replacement identity and appearance**

Do not allow one character reference to influence another character.

Do not allow character references to alter the original performance.

### FINAL RULE

This is NOT a recreation of the video.

This is NOT a reinterpretation of the video.

This is NOT a new generation inspired by the video.

This is a **strict character replacement operation**.

Everything remains unchanged unless it is necessary to replace the original person's visual identity with the assigned character reference.

The final video must contain the **same number of people**, performing the **same actions**, in the **same positions**, at the **same times**, while each original person has been replaced by their designated \`@CHARACTER\` reference.`;

export function modelPrompt(userText: string) {
  const extra = userText.trim();
  if (!extra) return CHARACTER_BASELINE_PROMPT;
  if (extra.startsWith("### CHARACTER REPLACEMENT")) return extra;
  return `${CHARACTER_BASELINE_PROMPT}\n\n${extra}`;
}
