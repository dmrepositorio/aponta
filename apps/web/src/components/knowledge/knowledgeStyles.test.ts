import { describe, expect, it } from 'vitest';
import * as styles from './knowledgeStyles';

describe('knowledgeStyles', () => {
  it('KNW-12: não mantém classe local de primário; o EzButton já usa brand-600 em todas as telas', () => {
    expect(styles).not.toHaveProperty('KNOWLEDGE_PRIMARY');
  });
});
