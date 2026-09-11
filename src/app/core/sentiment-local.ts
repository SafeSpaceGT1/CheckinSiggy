export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

export interface LocalSentimentResult {
  sentiment: Sentiment;
  confidence: number;
  summary: string;
  keywords: string[];
}

const POSITIVE = new Set([
  "good", "great", "happy", "calm", "grateful", "hopeful", "proud", "better",
  "love", "loved", "enjoy", "enjoyed", "peaceful", "excited", "progress",
  "win", "rested", "relief", "relieved", "connected", "fun", "smile",
  "smiled", "laughed", "warm", "safe", "steady", "energized", "content",
]);

const NEGATIVE = new Set([
  "sad", "angry", "anxious", "anxiety", "worried", "worry", "tired",
  "exhausted", "stress", "stressed", "lonely", "alone", "scared", "fear",
  "afraid", "hurt", "pain", "cry", "cried", "overwhelmed", "frustrated",
  "upset", "bad", "worse", "guilt", "guilty", "ashamed", "numb", "drained",
  "heavy", "restless", "tense",
]);

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "was", "were", "have", "has", "had",
  "for", "not", "but", "you", "your", "just", "like", "about", "when",
  "then", "them", "they", "there", "what", "some", "been", "from", "into",
  "over", "very", "really", "today", "still", "because", "would", "could",
  "should", "going", "want", "wanted", "feel", "feels", "felt", "feeling",
  "them", "were", "will", "than", "much", "more", "after", "before",
]);

const SUMMARIES: Record<Sentiment, string> = {
  positive: "This entry leans positive — nice to notice what felt good.",
  negative: "This entry carries some heavy feelings — putting them into words counts.",
  neutral: "This entry reads fairly even in tone.",
  mixed: "This entry holds a mix of feelings side by side.",
};

/**
 * Tiny on-device tone read used when the AI edge function isn't available
 * (no key configured, offline, etc.). Deliberately simple: word counting,
 * never interpretation — and never anything clinical.
 */
export function localSentiment(text: string): LocalSentimentResult {
  const tokens = (text.toLowerCase().match(/[a-z']+/g) ?? []).map((token) =>
    token.replace(/^'+|'+$/g, "")
  );

  let positive = 0;
  let negative = 0;
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    if (POSITIVE.has(token)) positive += 1;
    if (NEGATIVE.has(token)) negative += 1;
    if (token.length > 3 && !STOPWORDS.has(token)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  let sentiment: Sentiment;
  if (positive === 0 && negative === 0) {
    sentiment = "neutral";
  } else if (positive > negative * 1.5) {
    sentiment = "positive";
  } else if (negative > positive * 1.5) {
    sentiment = "negative";
  } else {
    sentiment = "mixed";
  }

  const confidence = Math.min(0.75, 0.35 + 0.05 * (positive + negative));

  const keywords = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return { sentiment, confidence, summary: SUMMARIES[sentiment], keywords };
}
