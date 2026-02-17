import { getNonce } from '../src/utils/getNonce';

describe('getNonce', () => {
  describe('basic functionality', () => {
    it('should generate a string', () => {
      const result = getNonce();
      expect(typeof result).toBe('string');
    });

    it('should generate exactly 32 characters', () => {
      const result = getNonce();
      expect(result.length).toBe(32);
    });

    it('should only contain allowed characters', () => {
      const result = getNonce();
      const allowedChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      
      for (let i = 0; i < result.length; i++) {
        expect(allowedChars.includes(result[i])).toBe(true);
      }
    });

    it('should not contain any special characters', () => {
      const result = getNonce();
      const disallowedChars = '!@#$%^&*()_+-=[]{}|;:,.<>?~`\\/"\'s';
      
      for (let i = 0; i < result.length; i++) {
        expect(disallowedChars.includes(result[i])).toBe(false);
      }
    });
  });

  describe('uniqueness and randomness', () => {
    it('should generate different nonces on multiple calls', () => {
      const nonce1 = getNonce();
      const nonce2 = getNonce();
      const nonce3 = getNonce();
      
      // They should all be different (very high probability)
      expect(nonce1).not.toBe(nonce2);
      expect(nonce1).not.toBe(nonce3);
      expect(nonce2).not.toBe(nonce3);
    });

    it('should have good entropy distribution', () => {
      const results: string[] = [];
      // Generate many nonces to test distribution
      for (let i = 0; i < 100; i++) {
        results.push(getNonce());
      }
      
      // Check that we don't have too many duplicates in a small sample
      const uniqueCount = new Set(results).size;
      expect(uniqueCount).toBeGreaterThan(95); // Should be close to 100 unique values
    });
  });
});