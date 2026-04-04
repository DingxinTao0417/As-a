import { KnowledgeBaseEntry } from './types';

export class KnowledgeBase {
  private entries: Map<string, KnowledgeBaseEntry> = new Map();

  addEntry(entry: KnowledgeBaseEntry): void {
    this.entries.set(entry.id, entry);
  }

  searchByKeywords(keywords: string[], language: 'ar' | 'en'): KnowledgeBaseEntry[] {
    const results: KnowledgeBaseEntry[] = [];

    for (const entry of this.entries.values()) {
      if (entry.language !== language) continue;

      const matchScore = this.calculateMatchScore(keywords, entry.keywords);
      if (matchScore > 0) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => {
      const scoreA = this.calculateMatchScore(keywords, a.keywords);
      const scoreB = this.calculateMatchScore(keywords, b.keywords);
      return scoreB - scoreA;
    });
  }

  searchByCategory(category: string, language: 'ar' | 'en'): KnowledgeBaseEntry[] {
    return Array.from(this.entries.values()).filter(
      (entry) => entry.category === category && entry.language === language
    );
  }

  private calculateMatchScore(keywords1: string[], keywords2: string[]): number {
    const set1 = new Set(keywords1.map((k) => k.toLowerCase()));
    const set2 = new Set(keywords2.map((k) => k.toLowerCase()));

    let matches = 0;
    for (const keyword of set1) {
      if (set2.has(keyword)) {
        matches++;
      }
    }

    return matches;
  }

  loadDefaultEntries(): void {
    const defaultEntries: KnowledgeBaseEntry[] = [
      {
        id: '1',
        question: 'How do I create an account?',
        answer: 'Click on Sign Up button and fill in your details.',
        category: 'account',
        language: 'en',
        keywords: ['account', 'signup', 'register', 'create'],
      },
    ];

    defaultEntries.forEach((entry) => this.addEntry(entry));
  }
}
