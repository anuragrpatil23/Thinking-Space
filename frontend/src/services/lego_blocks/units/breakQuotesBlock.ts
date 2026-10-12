/**
 * breakQuotesBlock — the daily quote shown on Home (the moon scene and the flat
 * welcome). Two sets, chosen by the time-of-day phase:
 *
 *   BUILD_QUOTES  05:00–23:00  building, thinking, starting, craft
 *   BREAK_QUOTES  23:00–05:00  the "take a break" wind-down ('late' phase)
 *
 * One quote per calendar day from the active set, selected deterministically so
 * it stays fixed and rotates at local midnight; each set cycles fully every
 * `length` days. The split exists because the wind-down set used to show all
 * day, and "close the laptop" is the wrong thing to read at 10am.
 *
 * Attribution policy: entries with an `author` are ones with a confident,
 * well-documented attribution (or a genuine proverb tradition). Author-less
 * entries are plain reminders, not attributed quotes — that keeps the set
 * honest instead of pinning shaky names onto aphorisms. Widely-cited-but-
 * uncertain lines are marked "(attributed)".
 */

import { computeTimePhaseBlock } from './timeOfDayBlock'

export interface BreakQuote {
  text: string
  author?: string
}

export const BUILD_QUOTES: readonly BreakQuote[] = Object.freeze([
  // — showing up —
  { text: 'Stay hungry. Stay foolish.', author: 'The Whole Earth Catalog' },
  { text: 'Inspiration exists, but it has to find you working.', author: 'Pablo Picasso (attributed)' },
  { text: 'Chance favors the prepared mind.', author: 'Louis Pasteur' },
  { text: 'Amateurs sit and wait for inspiration, the rest of us just get up and go to work.', author: 'Stephen King' },
  { text: 'The scariest moment is always just before you start.', author: 'Stephen King' },
  { text: 'Genius is one percent inspiration, ninety-nine percent perspiration.', author: 'Thomas Edison' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca (attributed)' },
  { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
  { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', author: 'Johann Wolfgang von Goethe' },
  { text: 'Waste no more time arguing what a good man should be. Be one.', author: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'Each morning we are born again. What we do today is what matters most.', author: 'Attributed to the Buddha' },
  { text: 'An early-morning walk is a blessing for the whole day.', author: 'Henry David Thoreau' },

  // — building —
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
  { text: 'Simple things should be simple, complex things should be possible.', author: 'Alan Kay' },
  { text: 'What I cannot create, I do not understand.', author: 'Richard Feynman' },
  { text: 'Live in the future, then build what’s missing.', author: 'Paul Graham' },
  { text: 'Make something people want.', author: 'Paul Graham' },
  { text: 'The best way to complain is to make things.', author: 'James Murphy' },
  { text: 'Real artists ship.', author: 'Steve Jobs' },
  { text: 'Everything around you that you call life was made up by people that were no smarter than you.', author: 'Steve Jobs' },
  { text: 'You can’t connect the dots looking forward; you can only connect them looking backwards.', author: 'Steve Jobs' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'The thing finds you. You just have to be building when it arrives.', author: 'Elon Musk (attributed)' },
  { text: 'The people who are crazy enough to think they can change the world are the ones who do.', author: 'Apple, “Think Different”' },
  { text: 'When something is important enough, you do it even if the odds are not in your favor.', author: 'Elon Musk' },
  { text: 'I think it is possible for ordinary people to choose to be extraordinary.', author: 'Elon Musk' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Abelson & Sussman' },
  { text: 'Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupéry' },
  { text: 'Be so good they can’t ignore you.', author: 'Steve Martin' },
  { text: 'You can’t use up creativity. The more you use, the more you have.', author: 'Maya Angelou' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Will Durant' },
  { text: 'Done is better than perfect.' },

  // — thinking —
  { text: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.', author: 'Richard Feynman' },
  { text: 'Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.', author: 'Richard Feynman' },
  { text: 'I have no special talents. I am only passionately curious.', author: 'Albert Einstein' },
  { text: 'If I have seen further, it is by standing on the shoulders of giants.', author: 'Isaac Newton' },
  { text: 'Writing is nature’s way of letting you know how sloppy your thinking is.', author: 'Dick Guindon' },
  { text: 'How do I know what I think until I see what I say?', author: 'E. M. Forster' },
  { text: 'I write entirely to find out what I’m thinking.', author: 'Joan Didion' },
  { text: 'The mind is not a vessel to be filled but a fire to be kindled.', author: 'Plutarch' },
  { text: 'The unexamined life is not worth living.', author: 'Socrates' },
  { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin (attributed)' },
  { text: 'It is not enough to be busy; so are the ants. The question is: what are we busy about?', author: 'Henry David Thoreau' },
  { text: 'Our life is frittered away by detail. Simplify, simplify.', author: 'Henry David Thoreau' },
  { text: 'Everything has beauty, but not everyone sees it.', author: 'Confucius' },
  { text: 'The cosmos is within us. We are made of star-stuff.', author: 'Carl Sagan' },
  { text: 'Look up at the stars and not down at your feet.', author: 'Stephen Hawking' },
  { text: 'Not all those who wander are lost.', author: 'J. R. R. Tolkien' },

  // — persistence —
  { text: 'We choose to go to the Moon, not because it is easy, but because it is hard.', author: 'John F. Kennedy (paraphrased)' },
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
  { text: 'Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.', author: 'Samuel Beckett' },
  { text: 'The credit belongs to the man who is actually in the arena.', author: 'Theodore Roosevelt' },
  { text: 'All progress depends on the unreasonable man.', author: 'George Bernard Shaw' },
  { text: 'Plans are worthless, but planning is everything.', author: 'Dwight D. Eisenhower' },
  { text: 'A good plan violently executed now is better than a perfect plan executed next week.', author: 'George S. Patton' },
  { text: 'Whether you think you can, or you think you can’t — you’re right.', author: 'Henry Ford (attributed)' },
  { text: 'Nature does not hurry, yet everything is accomplished.', author: 'Lao Tzu' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Lao Tzu' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius (attributed)' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', author: 'Confucius (attributed)' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', author: 'Chinese proverb' },
  { text: 'When the winds of change blow, some build walls and others build windmills.', author: 'Chinese proverb' },
  { text: 'You will never plow a field if you only turn it over in your mind.', author: 'Irish proverb' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese proverb' },
  { text: 'Vision without action is a daydream. Action without rest is a nightmare.', author: 'Japanese proverb' },
  { text: 'If you want to go fast, go alone. If you want to go far, go together.', author: 'African proverb' },
  { text: 'Well begun is half done.', author: 'Greek proverb' },
  { text: 'The obstacle is the path.', author: 'Zen proverb' },
  { text: 'When walking, walk. When eating, eat.', author: 'Zen proverb' },
  { text: 'Before enlightenment, chop wood, carry water. After enlightenment, chop wood, carry water.', author: 'Zen proverb' },
  { text: 'Slow is smooth, and smooth is fast.' },
  { text: 'Do not confuse motion with progress.' },
])

export const BREAK_QUOTES: readonly BreakQuote[] = Object.freeze([
  // — confident attributions —
  { text: 'Take rest; a field that has rested gives a bountiful crop.', author: 'Ovid' },
  { text: 'Almost everything will work again if you unplug it for a few minutes — including you.', author: 'Anne Lamott' },
  { text: 'Rest is not idleness, and to lie sometimes on the grass on a summer day is by no means a waste of time.', author: 'John Lubbock' },
  { text: "Life moves pretty fast. If you don't stop and look around once in a while, you could miss it.", author: "Ferris Bueller's Day Off" },
  { text: 'Adopt the pace of nature: her secret is patience.', author: 'Ralph Waldo Emerson' },
  { text: 'Finish each day and be done with it. Tomorrow is a new day.', author: 'Ralph Waldo Emerson' },
  { text: 'Silence is a source of great strength.', author: 'Lao Tzu' },
  { text: 'He who knows that enough is enough will always have enough.', author: 'Lao Tzu' },
  { text: 'For fast-acting relief, try slowing down.', author: 'Lily Tomlin' },
  { text: 'Rest is the sweet sauce of labor.', author: 'Plutarch' },
  { text: 'The time to relax is when you don’t have time for it.', author: 'Sydney J. Harris' },
  { text: 'A day of worry is more exhausting than a week of work.', author: 'John Lubbock' },
  { text: 'Sleep is the best meditation.', author: 'Dalai Lama' },
  { text: 'Rest and be thankful.', author: 'William Wordsworth' },
  { text: 'The quieter you become, the more you can hear.', author: 'Ram Dass' },
  { text: 'There is a time for many words, and there is also a time for sleep.', author: 'Homer, The Odyssey' },
  { text: 'Every now and then go away, have a little relaxation; when you return your judgment will be surer.', author: 'Leonardo da Vinci' },
  { text: 'Now and then it’s good to pause in our pursuit of happiness and just be happy.', author: 'Guillaume Apollinaire' },
  { text: 'We are all in the gutter, but some of us are looking at the stars.', author: 'Oscar Wilde' },
  { text: 'Smile, breathe, and go slowly.', author: 'Thich Nhat Hanh' },
  { text: 'Rivers know this: there is no hurry. We shall get there some day.', author: 'A. A. Milne' },
  { text: "Don't underestimate the value of doing nothing.", author: 'A. A. Milne' },
  { text: 'The sight of the stars makes me dream.', author: 'Vincent van Gogh' },
  { text: 'I have loved the stars too fondly to be fearful of the night.', author: 'Sarah Williams' },
  { text: 'Even the darkest night will end and the sun will rise.', author: 'Victor Hugo' },
  { text: 'Keep close to Nature’s heart, and break clear away, once in a while.', author: 'John Muir' },
  { text: 'The greatest weapon against stress is our ability to choose one thought over another.', author: 'William James' },
  { text: 'You are the sky. Everything else is just the weather.', author: 'Pema Chödrön' },
  { text: 'Within you there is a stillness and a sanctuary to which you can retreat at any time.', author: 'Hermann Hesse' },
  { text: 'There is more to life than increasing its speed.', author: 'Mahatma Gandhi' },
  { text: 'Sometimes the most important thing in a whole day is the rest we take between two deep breaths.', author: 'Etty Hillesum' },
  { text: 'Beware the barrenness of a busy life.', author: 'Attributed to Socrates' },
  { text: 'A good laugh and a long sleep are the two best cures for anything.', author: 'Irish proverb' },
  { text: 'The bamboo that bends is stronger than the oak that resists.', author: 'Japanese proverb' },
  { text: 'Sit quietly, doing nothing, and spring comes, and the grass grows by itself.', author: 'Zen proverb' },
  { text: 'Muddy water, let stand, becomes clear.', author: 'Zen proverb' },
  { text: 'Let go, or be dragged.', author: 'Zen proverb' },

  // — plain reminders (unattributed) —
  { text: 'Close the laptop. The world will keep spinning.' },
  { text: "You've done enough for today. Truly." },
  { text: 'The work will be there tomorrow. So will you — if you rest.' },
  { text: 'Your best ideas often arrive after you stop chasing them.' },
  { text: 'A tired mind makes poor decisions. Rest first, decide later.' },
  { text: 'Put it down. Pick it up in the morning.' },
  { text: "Rest is not quitting — it's how you keep going." },
  { text: 'The cursor will still blink tomorrow.' },
  { text: 'Great work needs a rested mind.' },
  { text: 'Walk away. Come back sharper.' },
  { text: 'The best debugging tool is a good night’s sleep.' },
  { text: 'If you’re reading this at 3am, this is your sign to log off.' },
  { text: 'Some problems solve themselves once you stop staring at them.' },
  { text: 'Trade one more hour of work for one more hour of sleep.' },
  { text: 'Whatever it is, it will look smaller after sleep.' },
  { text: 'Tonight, do less. Tomorrow, do it better.' },
  { text: 'Give the problem to your subconscious and go to bed.' },
  { text: 'You are not behind. You are just tired.' },
  { text: 'A calm mind is faster than a frantic one.' },
  { text: 'Sleep is not lost time. It is where the day gets sorted.' },
  { text: 'Trust that morning is better at hard things.' },
  { text: 'The best next step is often a step back.' },
  { text: 'Rest is not the reward for the work. It is part of the work.' },
  { text: 'You can pick up the thread in the morning. It waits well.' },
])

/**
 * The quote for a given moment. Deterministic per local calendar date within
 * the active set — the build set through the day and evening, the wind-down
 * set in the 'late' phase (23:00–05:00), matching the "take a break" eyebrow.
 */
export function quoteForDay(date: Date = new Date()): BreakQuote {
  const quotes = computeTimePhaseBlock(date) === 'late' ? BREAK_QUOTES : BUILD_QUOTES
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayIndex = Math.floor(startOfDay.getTime() / 86_400_000)
  const len = quotes.length
  const idx = ((dayIndex % len) + len) % len
  return quotes[idx]
}
