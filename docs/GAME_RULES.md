# Game rules and recovery

- Default room: 8 seats, 3 rounds, 80 seconds per drawing turn, Random mode with Classic words. Hosts can choose 2–12 seats and 1–10 rounds.
- Start requires at least 2 connected players; non-host players must mark ready. Changing room settings clears ready states. Rematch requires 2 connected players and resets scores.
- Each round gives each participating player a turn. A disconnected player is skipped when their turn begins. Late joins spectate until the next round.
- Drawer defaults to 15 seconds to choose one of 3 words; hosts can configure 10–30 selection seconds and 1–3 choices. Timeout chooses the first. All active, unguessed non-drawers may guess.
- Exact guesses normalize case, whitespace and punctuation. No fuzzy matching: an incorrect guess remains in the feed.
- Correct guess earns `100 + round(400 * remainingTime / turnDuration)`. Drawer gains 50 per correct player. Each player scores once per turn. All eligible connected players guessing correctly ends the turn early.
- Reveal lasts 5 seconds. An individual correct guess does not prematurely reveal the word to the rest of the room.
- Host departure transfers control to the first connected member. Room ownership is a UI privilege; the backend still controls all gameplay.
- Disconnected seats remain for 60 seconds. An absent drawer gets up to 20 seconds before the turn is revealed/skipped. If fewer than 2 active players remain, the game pauses, preserving time, for up to 60 seconds. A drawer timeout can end that pause earlier.
- Reconnecting restores the same ID, score, canvas and last 100 messages. Opening the same seat on another device removes the old socket's seat access.
- Leaving or being removed explicitly deletes the seat and score. The former token cannot restore it; the player may join again as a new seat. Empty rooms expire. A server restart discards all rooms.
- Guess input is separate from Chat mode. The drawer and successful guessers can chat. Messages containing the normalized answer are blocked during drawing/paused phases. Successful guesses appear only as a success event.
- 200 characters/message, 600ms between accepted message attempts; up to 60 commands/socket/second, 500 strokes and 20,000 canvas points. Input sizes are validated before entering game logic.

## Word modes and additional options

- Random mode samples the selected built-in pack. Custom mode uses only the named saved set chosen from the dropdown.
- Sets require 20–100 unique English words/phrases. Case, spaces and punctuation do not make duplicate answers unique. Words are 2–32 characters. App and server both validate these limits.
- Create, edit and delete sets in Word sets. Sets stay on the device. Rooms keep a copy, so later changes do not affect existing rooms unless the host explicitly saves new lobby settings.
- Hosts can choose 0–3 letter hints (default 2). Hints appear at evenly spaced fractions of drawing time, always leave at least two letters hidden, and stop progressing while paused.
- Hosts can disable mid-game joining. Reconnecting to an existing seat remains allowed.
