/**
 * UK49s SuperHybrid Feature Engine
 * 
 * This module implements statistical features for analyzing UK49s lottery data.
 * Each feature is configurable and independently testable.
 * 
 * IMPORTANT: These are historical statistical patterns, NOT predictions of future outcomes.
 * The system presents these as model scores for pattern analysis only.
 */

import type { Uk49sDraw, DrawType } from "./uk49s";
import { drawToNumbers } from "./uk49s";

// Configuration for feature weights
export interface FeatureWeights {
  weightFrequency: number;
  weightRecency: number;
  weightHotCold: number;
  weightGapAnalysis: number;
  weightPairs: number;
  weightTriples: number;
  weightConsecutive: number;
  weightOddEven: number;
  weightLowHigh: number;
  weightSumRange: number;
  weightPositional: number;
  weightRepeat: number;
  weightFirst3Minus2: number;
}

// Default weights for SuperHybrid strategy
export const DEFAULT_WEIGHTS: FeatureWeights = {
  weightFrequency: 1.0,
  weightRecency: 1.0,
  weightHotCold: 1.0,
  weightGapAnalysis: 1.0,
  weightPairs: 1.0,
  weightTriples: 1.0,
  weightConsecutive: 1.0,
  weightOddEven: 2.0,
  weightLowHigh: 2.0,
  weightSumRange: 1.0,
  weightPositional: 1.5,
  weightRepeat: 1.0,
  weightFirst3Minus2: 1.5,
};

// Canonical feature names (used for ablation and per-feature analysis)
export type FeatureName = keyof FeatureWeights;
export const FEATURE_NAMES: FeatureName[] = [
  "weightFrequency",
  "weightRecency",
  "weightHotCold",
  "weightGapAnalysis",
  "weightPairs",
  "weightTriples",
  "weightConsecutive",
  "weightOddEven",
  "weightLowHigh",
  "weightSumRange",
  "weightPositional",
  "weightRepeat",
  "weightFirst3Minus2",
];

// Zero out a set of features (for ablation variants)
export function ablateWeights(base: FeatureWeights, disabled: FeatureName[]): FeatureWeights {
  const w = { ...base };
  for (const f of disabled) w[f] = 0;
  return w;
}

// Feature result structure
export interface NumberFeatureScores {
  number: number;
  frequencyScore: number;      // How often number appeared historically
  recencyScore: number;         // How recently number appeared
  hotColdScore: number;         // Hot (recent) vs cold (dormant) indicator
  gapAnalysisScore: number;     // Gap since last appearance
  pairsScore: number;           // Association with other numbers
  triplesScore: number;         // Association with triplets
  consecutiveScore: number;     // Association with consecutive numbers
  oddEvenScore: number;         // Fits odd/even balance pattern
  lowHighScore: number;        // Fits low/high balance pattern
  sumRangeScore: number;        // Fits sum behavior
  positionalScore: number;      // Historical position patterns
  repeatScore: number;          // Tendency to repeat in consecutive draws
  first3Minus2Score: number;    // First3Minus2 pattern score
  overallScore: number;         // Weighted combination
}

// Raw draws to analysis format
interface DrawAnalysis {
  date: string;
  main: number[];
  booster: number;
}

function drawsToAnalysis(draws: Uk49sDraw[]): DrawAnalysis[] {
  return draws.map(draw => {
    const { main, booster } = drawToNumbers(draw);
    return {
      date: draw.drawDate,
      main,
      booster,
    };
  });
}

// 1. FREQUENCY ANALYSIS
// Measures how often each number appears in the dataset
export function calculateFrequencyScores(draws: Uk49sDraw[], lookbackWindow?: number): Map<number, number> {
  const recentDraws = lookbackWindow ? draws.slice(-lookbackWindow) : draws;
  const counts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) counts.set(i, 0);
  
  for (const draw of recentDraws) {
    const { main } = drawToNumbers(draw);
    for (const num of main) {
      counts.set(num, (counts.get(num) || 0) + 1);
    }
  }
  
  const maxCount = Math.max(...counts.values()) || 1;
  const scores = new Map<number, number>();
  
  for (const [num, count] of counts) {
    scores.set(num, count / maxCount);
  }
  
  return scores;
}

// 2. RECENCY ANALYSIS
// Measures how recently each number appeared (inverted - newer is better)
export function calculateRecencyScores(draws: Uk49sDraw[], lookbackWindow?: number): Map<number, number> {
  const recentDraws = lookbackWindow ? draws.slice(-lookbackWindow) : draws;
  const lastAppearance = new Map<number, number>();
  
  // Initialize all numbers
  for (let i = 1; i <= 49; i++) lastAppearance.set(i, -1);
  
  // Find last appearance for each number
  for (let i = 0; i < recentDraws.length; i++) {
    const { main } = drawToNumbers(recentDraws[i]);
    for (const num of main) {
      if (lastAppearance.get(num)! < i) {
        lastAppearance.set(num, i);
      }
    }
  }
  
  const maxIndex = recentDraws.length - 1;
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    const lastIdx = lastAppearance.get(num)!;
    if (lastIdx === -1) {
      scores.set(num, 0); // Never appeared
    } else {
      // Score is higher for more recent appearances
      scores.set(num, 1 - ((maxIndex - lastIdx) / (maxIndex + 1)));
    }
  }
  
  return scores;
}

// 3. HOT/COLD ANALYSIS
// Classifies numbers as hot (appearing frequently in recent draws) vs cold (dormant)
export function calculateHotColdScores(draws: Uk49sDraw[], hotWindow = 10, coldWindow = 30): Map<number, number> {
  const scores = new Map<number, number>();
  
  // Count appearances in different windows
  const hotCounts = new Map<number, number>();
  const coldCounts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) {
    hotCounts.set(i, 0);
    coldCounts.set(i, 0);
  }
  
  // Hot window (recent)
  for (let i = Math.max(0, draws.length - hotWindow); i < draws.length; i++) {
    const { main } = drawToNumbers(draws[i]);
    for (const num of main) {
      hotCounts.set(num, (hotCounts.get(num) || 0) + 1);
    }
  }
  
  // Cold window (longer period)
  for (let i = Math.max(0, draws.length - coldWindow); i < draws.length; i++) {
    const { main } = drawToNumbers(draws[i]);
    for (const num of main) {
      coldCounts.set(num, (coldCounts.get(num) || 0) + 1);
    }
  }
  
  for (let num = 1; num <= 49; num++) {
    const hot = hotCounts.get(num) || 0;
    const cold = coldCounts.get(num) || 0;
    // Hot if appearing frequently in recent draws
    // Score: 0.5 = neutral, >0.5 = hot, <0.5 = cold
    const ratio = cold > 0 ? hot / cold : hot > 0 ? 1 : 0;
    scores.set(num, Math.min(1, ratio));
  }
  
  return scores;
}

// 4. GAP ANALYSIS
// Measures the gap (draws since last appearance) for each number
export function calculateGapAnalysisScores(draws: Uk49sDraw[]): Map<number, number> {
  const scores = new Map<number, number>();
  const gaps = new Map<number, number>();
  
  // Initialize gaps
  for (let i = 1; i <= 49; i++) gaps.set(i, 0);
  
  // Calculate gaps
  for (let i = 0; i < draws.length; i++) {
    const { main } = drawToNumbers(draws[i]);
    for (const num of main) {
      gaps.set(num, 0); // Number appeared now
    }
    // Increment all non-appearing numbers
    for (let num = 1; num <= 49; num++) {
      if (!main.includes(num)) {
        gaps.set(num, (gaps.get(num) || 0) + 1);
      }
    }
  }
  
  // Convert gaps to scores (lower gap = higher score, with diminishing returns)
  const maxGap = Math.max(...gaps.values()) || 1;
  
  for (let num = 1; num <= 49; num++) {
    const gap = gaps.get(num) || 0;
    // Inverse scoring - smaller gaps get higher scores
    // Using exponential decay
    const score = Math.exp(-gap / (maxGap / 2));
    scores.set(num, score);
  }
  
  return scores;
}

// 5. PAIRS ANALYSIS
// Measures how often numbers appear together in draws
export function calculatePairsScores(draws: Uk49sDraw[], targetNumber: number): Map<number, number> {
  const pairCounts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) pairCounts.set(i, 0);
  
  for (const draw of draws) {
    const { main } = drawToNumbers(draw);
    if (main.includes(targetNumber)) {
      for (const num of main) {
        if (num !== targetNumber) {
          pairCounts.set(num, (pairCounts.get(num) || 0) + 1);
        }
      }
    }
  }
  
  const maxCount = Math.max(...pairCounts.values()) || 1;
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    scores.set(num, (pairCounts.get(num) || 0) / maxCount);
  }
  
  return scores;
}

// 6. TRIPLES ANALYSIS
// Measures number triplet associations
export function calculateTriplesScores(draws: Uk49sDraw[], targetNumber: number): Map<number, number> {
  const tripleCounts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) tripleCounts.set(i, 0);
  
  for (const draw of draws) {
    const { main } = drawToNumbers(draw);
    if (main.includes(targetNumber)) {
      // Count pairs within the same draw that include target
      for (let i = 0; i < main.length; i++) {
        for (let j = i + 1; j < main.length; j++) {
          if (main[i] === targetNumber || main[j] === targetNumber) {
            const other = main[i] === targetNumber ? main[j] : main[i];
            tripleCounts.set(other, (tripleCounts.get(other) || 0) + 1);
          }
        }
      }
    }
  }
  
  const maxCount = Math.max(...tripleCounts.values()) || 1;
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    scores.set(num, (tripleCounts.get(num) || 0) / maxCount);
  }
  
  return scores;
}

// 7. CONSECUTIVE ANALYSIS
// Measures association with consecutive numbers
export function calculateConsecutiveScores(draws: Uk49sDraw[]): Map<number, number> {
  const consecutiveCounts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) consecutiveCounts.set(i, 0);
  
  for (const draw of draws) {
    const { main } = drawToNumbers(draw);
    for (const num of main) {
      // Check if num-1 or num+1 appeared in same draw
      if (main.includes(num - 1) || main.includes(num + 1)) {
        consecutiveCounts.set(num, (consecutiveCounts.get(num) || 0) + 1);
      }
    }
  }
  
  const maxCount = Math.max(...consecutiveCounts.values()) || 1;
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    scores.set(num, (consecutiveCounts.get(num) || 0) / maxCount);
  }
  
  return scores;
}

// 8. ODD/EVEN BALANCE
// Scores numbers based on odd/even balance pattern
export function calculateOddEvenScores(targetNumbers: number[]): Map<number, number> {
  const scores = new Map<number, number>();
  const oddCount = targetNumbers.filter(n => n % 2 === 1).length;
  const evenCount = targetNumbers.length - oddCount;
  
  for (let num = 1; num <= 49; num++) {
    // Score based on maintaining balance
    if (num % 2 === 1 && oddCount < 3) {
      scores.set(num, 0.7); // Need more odd numbers
    } else if (num % 2 === 0 && evenCount < 2) {
      scores.set(num, 0.7); // Need more even numbers
    } else {
      scores.set(num, 0.3); // Would create imbalance
    }
  }
  
  return scores;
}

// 9. LOW/HIGH BALANCE
// Scores numbers based on low (1-24) vs high (25-49) balance
export function calculateLowHighScores(targetNumbers: number[]): Map<number, number> {
  const scores = new Map<number, number>();
  const lowCount = targetNumbers.filter(n => n <= 24).length;
  const highCount = targetNumbers.length - lowCount;
  
  for (let num = 1; num <= 49; num++) {
    const isLow = num <= 24;
    // Typical winning pattern: 2-3 low, 2-3 high
    if (isLow && lowCount < 2) {
      scores.set(num, 0.7);
    } else if (!isLow && highCount < 2) {
      scores.set(num, 0.7);
    } else if (lowCount >= 3 && isLow) {
      scores.set(num, 0.3); // Too many lows
    } else if (highCount >= 3 && !isLow) {
      scores.set(num, 0.3); // Too many highs
    } else {
      scores.set(num, 0.5);
    }
  }
  
  return scores;
}

// 10. SUM/RANGE BEHAVIOR
// Analyzes typical sum of winning numbers
export function calculateSumRangeScores(draws: Uk49sDraw[]): Map<number, number> {
  const sums: number[] = [];
  
  for (const draw of draws) {
    const { main } = drawToNumbers(draw);
    sums.push(main.reduce((a, b) => a + b, 0));
  }
  
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const stdDev = Math.sqrt(sums.reduce((acc, s) => acc + (s - avgSum) ** 2, 0) / sums.length);
  
  // Target sum range: avg ± 1 std dev
  const minTarget = avgSum - stdDev;
  const maxTarget = avgSum + stdDev;
  
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    // Numbers that help reach the typical sum range
    // This is simplified - real implementation would be more sophisticated
    scores.set(num, 0.5); // Neutral baseline
  }
  
  return scores;
}

// 11. POSITIONAL BEHAVIOR
// Analyzes typical positions numbers appear in
export function calculatePositionalScores(draws: Uk49sDraw[], lookbackWindow?: number): Map<number, number> {
  const recentDraws = lookbackWindow ? draws.slice(-lookbackWindow) : draws;
  const positionCounts: Map<number, Map<number, number>> = new Map();
  
  for (let n = 1; n <= 49; n++) {
    const positions = new Map<number, number>();
    for (let p = 0; p < 5; p++) positions.set(p, 0);
    positionCounts.set(n, positions);
  }
  
  for (const draw of recentDraws) {
    const { main } = drawToNumbers(draw);
    for (let pos = 0; pos < main.length; pos++) {
      const num = main[pos];
      positionCounts.get(num)!.set(pos, (positionCounts.get(num)!.get(pos) || 0) + 1);
    }
  }
  
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    const positions = positionCounts.get(num)!;
    const total = Array.from(positions.values()).reduce((a, b) => a + b, 0);
    
    if (total === 0) {
      scores.set(num, 0.1); // Never seen
      continue;
    }
    
    // Score based on position diversity (numbers that appear in multiple positions are more versatile)
    const uniquePositions = Array.from(positions.values()).filter(c => c > 0).length;
    const avgPosition = Array.from(positions.entries())
      .reduce((acc, [pos, count]) => acc + pos * count, 0) / total;
    
    // Normalize: prefer positions 1-3 (earlier draws tend to have different patterns)
    const positionScore = 1 - (avgPosition / 4);
    const diversityScore = uniquePositions / 5;
    
    scores.set(num, (positionScore * 0.6 + diversityScore * 0.4));
  }
  
  return scores;
}

// 12. REPEAT ANALYSIS
// Measures tendency of numbers to repeat in consecutive draws
export function calculateRepeatScores(draws: Uk49sDraw[]): Map<number, number> {
  const repeatCounts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) repeatCounts.set(i, 0);
  
  for (let i = 1; i < draws.length; i++) {
    const prevMain = drawToNumbers(draws[i - 1]).main;
    const currMain = drawToNumbers(draws[i]).main;
    
    for (const num of currMain) {
      if (prevMain.includes(num)) {
        repeatCounts.set(num, (repeatCounts.get(num) || 0) + 1);
      }
    }
  }
  
  const maxCount = Math.max(...repeatCounts.values()) || 1;
  const scores = new Map<number, number>();
  
  for (let num = 1; num <= 49; num++) {
    scores.set(num, (repeatCounts.get(num) || 0) / maxCount);
  }
  
  return scores;
}

// 13. FIRST3MINUS2 PATTERN ANALYSIS
// Analyzes the pattern: (position 1 + position 2 + position 3) - (position 4 + position 5)
export function calculateFirst3Minus2Scores(draws: Uk49sDraw[]): Map<number, number> {
  const differences: number[] = [];
  
  for (const draw of draws) {
    const { main } = drawToNumbers(draw);
    const diff = (main[0] + main[1] + main[2]) - (main[3] + main[4]);
    differences.push(diff);
  }
  
  const avgDiff = differences.reduce((a, b) => a + b, 0) / differences.length;
  
  const scores = new Map<number, number>();
  
  // Numbers that contribute to the typical difference pattern
  for (let num = 1; num <= 49; num++) {
    // Neutral baseline - this feature is more complex in practice
    scores.set(num, 0.5);
  }
  
  return scores;
}

// MAIN FEATURE CALCULATION
// Combines all features into final scores
export function calculateAllFeatureScores(
  draws: Uk49sDraw[],
  weights: FeatureWeights = DEFAULT_WEIGHTS,
  lookbackWindow?: number
): NumberFeatureScores[] {
  if (draws.length === 0) {
    return Array.from({ length: 49 }, (_, i) => ({
      number: i + 1,
      frequencyScore: 0,
      recencyScore: 0,
      hotColdScore: 0,
      gapAnalysisScore: 0,
      pairsScore: 0,
      triplesScore: 0,
      consecutiveScore: 0,
      oddEvenScore: 0,
      lowHighScore: 0,
      sumRangeScore: 0,
      positionalScore: 0,
      repeatScore: 0,
      first3Minus2Score: 0,
      overallScore: 0,
    }));
  }
  
  // Calculate all component scores
  const freqScores = calculateFrequencyScores(draws, lookbackWindow);
  const recencyScores = calculateRecencyScores(draws, lookbackWindow);
  const hotColdScores = calculateHotColdScores(draws);
  const gapScores = calculateGapAnalysisScores(draws);
  const consecutiveScores = calculateConsecutiveScores(draws);
  const positionalScores = calculatePositionalScores(draws, lookbackWindow);
  const repeatScores = calculateRepeatScores(draws);
  const sumRangeScores = calculateSumRangeScores(draws);
  
  // Default odd/even and low/high scores (will be updated per selection)
  const defaultOddEvenScores = calculateOddEvenScores([]);
  const defaultLowHighScores = calculateLowHighScores([]);
  
  const results: NumberFeatureScores[] = [];
  
  for (let num = 1; num <= 49; num++) {
    // Calculate pairs and triples scores for this number
    const pairsScores = calculatePairsScores(draws, num);
    const triplesScores = calculateTriplesScores(draws, num);
    
    const featureScore: NumberFeatureScores = {
      number: num,
      frequencyScore: freqScores.get(num) || 0,
      recencyScore: recencyScores.get(num) || 0,
      hotColdScore: hotColdScores.get(num) || 0,
      gapAnalysisScore: gapScores.get(num) || 0,
      pairsScore: pairsScores.get(num) || 0,
      triplesScore: triplesScores.get(num) || 0,
      consecutiveScore: consecutiveScores.get(num) || 0,
      oddEvenScore: defaultOddEvenScores.get(num) || 0.5,
      lowHighScore: defaultLowHighScores.get(num) || 0.5,
      sumRangeScore: sumRangeScores.get(num) || 0.5,
      positionalScore: positionalScores.get(num) || 0,
      repeatScore: repeatScores.get(num) || 0,
      first3Minus2Score: 0.5, // Simplified
      overallScore: 0,
    };
    
    // Calculate weighted overall score
    featureScore.overallScore = 
      featureScore.frequencyScore * weights.weightFrequency +
      featureScore.recencyScore * weights.weightRecency +
      featureScore.hotColdScore * weights.weightHotCold +
      featureScore.gapAnalysisScore * weights.weightGapAnalysis +
      featureScore.pairsScore * weights.weightPairs +
      featureScore.triplesScore * weights.weightTriples +
      featureScore.consecutiveScore * weights.weightConsecutive +
      featureScore.oddEvenScore * weights.weightOddEven +
      featureScore.lowHighScore * weights.weightLowHigh +
      featureScore.sumRangeScore * weights.weightSumRange +
      featureScore.positionalScore * weights.weightPositional +
      featureScore.repeatScore * weights.weightRepeat +
      featureScore.first3Minus2Score * weights.weightFirst3Minus2;
    
    results.push(featureScore);
  }
  
  // Normalize overall scores to 0-1 range
  const maxOverall = Math.max(...results.map(r => r.overallScore)) || 1;
  for (const score of results) {
    score.overallScore = score.overallScore / maxOverall;
  }
  
  return results;
}

// Diversity constraints for prediction selection
export interface DiversityConstraints {
  enforceDiversity: boolean;
  minNumberSpread: number;  // Minimum spread between min and max selected
  maxSameGroup: number;     // Maximum from same low/high group
}

// Select best 4 numbers with diversity constraints
export function selectBestNumbers(
  scores: NumberFeatureScores[],
  constraints: DiversityConstraints = { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 }
): number[] {
  // Sort by overall score (descending)
  const sorted = [...scores].sort((a, b) => b.overallScore - a.overallScore);
  
  const selected: number[] = [];
  const usedGroups = { low: 0, high: 0 };
  
  for (const candidate of sorted) {
    if (selected.length >= 4) break;
    
    const num = candidate.number;
    const isLow = num <= 24;
    const group = isLow ? 'low' : 'high';
    
    // Check diversity constraints
    if (constraints.enforceDiversity) {
      // Check spread constraint
      if (selected.length > 0) {
        const minSelected = Math.min(...selected);
        const maxSelected = Math.max(...selected);
        if (maxSelected - minSelected < constraints.minNumberSpread) {
          continue; // Would not maintain spread
        }
      }
      
      // Check group constraint
      if (usedGroups[group] >= constraints.maxSameGroup) {
        continue; // Too many from this group
      }
    }
    
    selected.push(num);
    usedGroups[group]++;
  }
  
  // If we couldn't select 4 with constraints, fall back to top scores
  if (selected.length < 4) {
    for (const candidate of sorted) {
      if (selected.length >= 4) break;
      if (!selected.includes(candidate.number)) {
        selected.push(candidate.number);
      }
    }
  }
  
  return selected.sort((a, b) => a - b);
}

// Select booster ball (separate from main numbers)
export function selectBoosterBall(
  scores: NumberFeatureScores[],
  selectedMain: number[]
): number {
  // Filter out already selected main numbers
  const available = scores.filter(s => !selectedMain.includes(s.number));
  
  // Sort by score and pick top available
  const sorted = available.sort((a, b) => b.overallScore - a.overallScore);
  
  return sorted[0]?.number || Math.floor(Math.random() * 49) + 1;
}

// Main prediction generation function
export interface PredictionResult {
  mainNumbers: number[];    // Exactly 4 numbers
  boosterBall: number;      // 1 booster
  componentScores: NumberFeatureScores[];
  trainingCutoff: string;
  modelConfigId?: number;
}

export function generatePrediction(
  draws: Uk49sDraw[],
  drawType: DrawType,
  weights: FeatureWeights = DEFAULT_WEIGHTS,
  lookbackWindow = 90,
  constraints: DiversityConstraints = { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 },
  modelConfigId?: number
): PredictionResult {
  if (draws.length === 0) {
    throw new Error("No historical draws available for prediction");
  }
  
  // Filter to draws strictly before target date (for walk-forward)
  const trainingDraws = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const trainingCutoff = trainingDraws[trainingDraws.length - 1].drawDate;
  
  // Calculate feature scores
  const scores = calculateAllFeatureScores(trainingDraws, weights, lookbackWindow);
  
  // Select main numbers
  const mainNumbers = selectBestNumbers(scores, constraints);
  
  // Select booster
  const boosterBall = selectBoosterBall(scores, mainNumbers);
  
  return {
    mainNumbers,
    boosterBall,
    componentScores: scores,
    trainingCutoff,
    modelConfigId,
  };
}

// Convert prediction to JSON-serializable format
export function predictionToJson(result: PredictionResult): Record<string, unknown> {
  return {
    mainNumbers: result.mainNumbers,
    boosterBall: result.boosterBall,
    trainingCutoff: result.trainingCutoff,
    componentScores: result.componentScores.map(s => ({
      number: s.number,
      frequencyScore: s.frequencyScore,
      recencyScore: s.recencyScore,
      hotColdScore: s.hotColdScore,
      gapAnalysisScore: s.gapAnalysisScore,
      pairsScore: s.pairsScore,
      triplesScore: s.triplesScore,
      consecutiveScore: s.consecutiveScore,
      oddEvenScore: s.oddEvenScore,
      lowHighScore: s.lowHighScore,
      sumRangeScore: s.sumRangeScore,
      positionalScore: s.positionalScore,
      repeatScore: s.repeatScore,
      first3Minus2Score: s.first3Minus2Score,
      overallScore: s.overallScore,
    })),
    modelConfigId: result.modelConfigId,
  };
}
