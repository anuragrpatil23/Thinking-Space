// The standard words for each part of a model diagram: the chip on the step
// strip, the name of the bar a part produces, the sign in its circle, and the
// explanation under the drawing. One set per kind of part, shared by every
// model, taken from the hand-built page the engine replaces
// (gpt-with-sparse-network.html). A model's own sentence for a step comes from
// its spec and is shown above the standard explanation.

/** The kinds of unit the drawing knows how to open up. */
export type ModelDiagramUnitKind =
  | 'lookup' | 'norm' | 'linear' | 'dot' | 'softmax' | 'mix' | 'sum' | 'relu' | 'plain'

export const MODEL_DIAGRAM_CIRCLE_BLOCK: Record<string, string> = {
  linear: 'Σ', sum: '+', norm: 'norm', softmax: 'softmax', dot: 'q·k', mix: 'Σ', leaf: 'mask',
  lookup: '+', patchify: 'cut', join: 'join', memory: 'mem', act: 'f', plain: 'Σ',
}

export const MODEL_DIAGRAM_UNIT_TAG_BLOCK: Record<string, string> = {
  sum: 'ADD', norm: 'LAYER NORM', softmax: 'SOFTMAX', dot: 'QUERY · KEY', mix: 'MIX', leaf: 'MASKED',
  lookup: 'LOOK UP + ADD', patchify: 'CUT INTO PATCHES', join: 'JOIN', memory: 'MEMORY', act: 'BEND', gelu: 'UNIT', position: 'ADD ITS PLACE', linear: 'LAYER',
}

export interface ModelDiagramTextFactsBlock {
  heads: number
  headWidth: number
  width: string
  mlpWidth: string
  vocab: string
  act: string
  addStep: number
  /** A memory's heads and the side of each head's square, when the model has one. */
  memHeads?: number
  memSide?: number
}

/** The standard explanation of one part, by the part's name. */
export function modelDiagramPartTextBlock(part: string, f: ModelDiagramTextFactsBlock): string {
  switch (part) {
    case 'embed':
      return 'On the far left are the words, each one just a row number. A word picks its row from the word table, which has one row for every word the network knows. Its position picks a row from the position table. The two rows are added, column by column. Both tables are weights, so they have no batch behind them: they are the same for every example. What comes out is the stream: one row of C numbers for every position.'
    case 'embed-only':
      return 'On the far left are the words, each one just a row number. A word picks its row from the word table, which has one row for every word the network knows. The table is weights, so it has no batch behind it: it is the same for every example. What comes out is the stream: one row of C numbers for every position.'
    case 'norm':
      return 'Layer norm works on one position at a time. It shifts and rescales that position’s C numbers so their mean is 0 and their spread is 1, then applies its own scale and shift, which are weights. It keeps the stream in a steady range.'
    case 'norm-again':
      return 'The same rescaling as before, with its own scale and shift, applied to each position separately.'
    case 'norm-final':
      return 'One last rescaling of each position’s row before reading out an answer. In a full model, many more blocks sit between the first block and this step.'
    case 'q':
      return 'A linear layer, exactly your Regular MLP drawing without the ReLU. Each neuron is one equation with C slopes and 1 intercept. The query is what this position is looking for. The columns split into heads.'
    case 'k':
      return 'The same kind of linear layer, with its own weights, reading the same input. The key is what a position offers to be found by.'
    case 'v':
      return 'A third linear layer of the same kind, reading the same input. The value is what a position hands over if another position chooses to look at it. Notice in the whole drawing that the values skip past the similarity steps and are used later, at the mixing step.'
    case 'scores':
      return 'Take the query at one position and the key at another. Within one head, multiply them pair by pair and add up. That gives one number for each pair of positions, a T by T grid. Pairs where the key comes later than the query are masked, so a position can only look at itself and what came before.'
    case 'scores-open':
      return 'Take the query at one position and the key at another. Within one head, multiply them pair by pair and add up. That gives one number for each pair of positions, a T by T grid. Nothing is masked here: every position can look at every other.'
    case 'weights':
      return 'This step is called softmax. It takes one row of scores and turns it into numbers that are all positive and add up to 1, so each is that score’s share of the row. Two moves: raise e to each score, which makes it positive and stretches the gaps, then divide each by the sum of them all. The result is a row of attention weights: how much this position takes from each earlier position. Only the gaps between scores matter, so it is fine that they are all negative.'
    case 'mix':
      return `The one step where words exchange information. Queries and keys have already decided where each word looks: that is its row of attention weights. Now each earlier word’s value is weighted by the attention given to it, and the weighted values are added up. A value is written as a row of channels, so the same weight applies down every one of those channels, across the words. The result is one aggregate value for the receiving word. Every word has its own attention row, so every word gets its own aggregate. Each head does this separately over its own ${f.headWidth} channels, and the ${f.heads} results sit side by side. Everything else in the block works on each word separately.`
    case 'out':
      return 'One more linear layer, C neurons each with C slopes and 1 intercept. It turns the mixed values into what attention will add to the stream.'
    case 'add-attention':
      return 'Attention does not replace the stream. Its result is added to it, number by number: same word, same channel. So a word keeps everything it had and gains what it gathered. The long dashed line from the embedding is the stream being carried past all of attention unchanged, and it meets attention’s result here. Every branch in every block does this: read the stream, work something out, add it back. That makes the stream a running total that nothing overwrites, which is why a later block can read what any earlier one wrote.'
    case 'add-mlp':
      return 'The MLP’s result is added to the stream. This is the stream that leaves the block, and in a larger model it is what the next block reads.'
    case 'add':
      return 'The branch’s result is added to the stream, number by number: same word, same channel. Nothing the stream held is overwritten.'
    case 'mlp-up':
      return `Your Regular MLP drawing. Each neuron is one equation: C slopes, 1 intercept, a sum, then ${f.act}, which is a smooth version of ReLU. There are more neurons than channels, so the row gets wider. Two different sizes are in play here and they are easy to mix up. Each neuron is ${f.width} numbers wide, because it has one slope for each channel it reads: it is a direction in the ${f.width}-dimensional stream. There are ${f.mlpWidth} such neurons, so what comes out is ${f.mlpWidth} numbers per word. Look at the rulers under the bars. When people say a neuron fires, they mean the number that comes out here is large.`
    case 'mlp-down':
      return 'A linear layer going back down to C. Each of its neurons has one slope for every neuron of the layer before, plus an intercept. Eight are drawn, and the rest are added as one line.'
    case 'unembed':
      return 'A linear layer with one neuron for every word the network knows. Each neuron has C slopes and no intercept. Its output is a score for that word coming next.'
    case 'output':
      return `Softmax again, the same step as the attention weights, this time across all ${f.vocab} tokens. Raise e to each score, then divide by the sum of them all, so the row adds up to 1. The largest share is the token the network writes next.`
    case 'linear':
      return 'A linear layer. Each neuron is one equation: one slope for every number it reads, and 1 intercept.'
    case 'memory-q':
      return 'A linear layer, one equation per neuron. For each token it makes the key that token will read the memory with. The result is then blurred over the last 4 tokens, so a token’s key carries a little of the tokens just before it.'
    case 'memory-k':
      return 'The same kind of linear layer, with its own weights, reading the same input. It makes the key that says where in the memory this token writes. It is blurred over the last 4 tokens too.'
    case 'memory-v':
      return 'A third linear layer of the same kind. It makes what this token writes into the memory.'
    case 'memory-write':
      return `The memory is ${f.memHeads ?? 'several'} squares of ${f.memSide ?? 'N'} by ${f.memSide ?? 'N'} numbers, one square per head, and it is the same size however long the text is. Tokens are taken one at a time, in order. At each token the memory first fades a little, by an amount the token itself sets for each head. Then the token writes: what it has to write is stored against its write key, with a strength the token also sets. So after any token the memory holds a trace of every token up to that one, and nothing of the tokens after it. Attention keeps every earlier token and looks back at all of them; this keeps one fixed-size summary instead, which is why the work per token does not grow. The drawing shows the memory after the last token: the first 2 by 2 numbers of each head’s square.`
    case 'memory-read':
      return `Each token reads the memory as it stood at that token. Each head’s square is multiplied by that head’s part of the token’s read key, which gives ${f.memSide ?? 'N'} numbers per head. Each head’s reading is scaled by its root mean square, so its size is about one. Then a gate, a linear layer reading the token’s own row, sets how much of each number gets through. The ${f.memHeads ?? ''} readings sit side by side as one row.`
    case 'memory-out':
      return 'One more linear layer. It turns the readings into what the memory adds to the stream.'
    case 'gate':
      return 'A linear layer reading the same input as the query. For each head it makes a row of numbers that will decide how much of that head’s result gets through.'
    case 'gate-mix':
      return 'Here the mixed values are then multiplied, number by number, by the gate squeezed to between 0 and 1, so a head can be turned down for one token and up for another.'
    case 'mlp-gate':
      return `A linear layer: each neuron is one equation with one slope for every channel it reads. There are ${f.mlpWidth} neurons, so the row gets wider. This layer’s result will be bent and used as a gate on the layer drawn below it.`
    case 'mlp-up-plain':
      return `A second linear layer of the same size, with its own weights, reading the same row. Its ${f.mlpWidth} sums are not bent: they are what the gate will let through.`
    case 'mlp-times':
      return `The gate layer’s sums are bent by ${f.act}, a smooth version of ReLU, and each one is multiplied by the matching sum of the up layer. A neuron fires when both are large: its gate is open and it has something to pass.`
    case 'memory':
      return 'A memory of fixed size. It is read and updated once for each token, in order, so what it holds at one token depends on every token before it.'
    case 'join':
      return 'Two rows of tokens are put in one line. From here on the network cannot tell which came from where: each is one row of the stream.'
    case 'patchify':
      return 'The picture is cut into small squares, and each square’s numbers are laid out as one row. From here on a square is a token like any word.'
    case 'position':
      return 'Each position picks a row from the position table, so the network can tell the first token from the fifth.'
    case 'act':
      return 'A bend applied to each number on its own. Without it, layers of sums would collapse into one sum.'
    default:
      return ''
  }
}
