# AI Auto-Translation System - i18next Integration

This document explains how the AI auto-translation system integrates with i18next to provide automatic translation capabilities.

## Overview

The system extends the existing i18next configuration with automatic translation capabilities using Gemini AI. When a translation key is missing, the system automatically:

1. Detects the missing key through i18next's `missingKeyHandler`
2. Extracts context using `parseMissingKeyHandler`
3. Requests translation from Gemini AI
4. Saves the translation to the appropriate file
5. Reloads i18next resources to make the translation available immediately

## Usage

### Basic Translation Hook

```typescript
import { useAutoTranslation } from '../hooks/useAutoTranslation';

function MyComponent() {
  const { t, changeLanguage, currentLanguage, availableLanguages } = useAutoTranslation();

  return (
    <div>
      <p>{t('welcome')}</p>
      <p>{t('user.greeting', { name: 'John' })}</p>
      <p>{t('new.key.that.will.be.translated')}</p>
    </div>
  );
}
```

### Backward Compatibility

The system maintains full backward compatibility with react-i18next:

```typescript
import { useTranslation } from 'react-i18next';
// or
import { useTranslation } from '../hooks/useAutoTranslation';

// Both work exactly the same way
function MyComponent() {
  const { t } = useTranslation();
  return <p>{t('existing.key')}</p>;
}
```

## Features

### Automatic Translation
- Missing keys are automatically detected and translated
- Translations are saved to appropriate language files
- Resources are reloaded immediately for instant availability

### Context-Aware Translation
- The system extracts context from key names (e.g., `nav.menu.home` → "Navigation menu")
- Better translation quality through contextual prompts

### Multi-Language Support
- Automatically detects available languages
- Translates missing keys to all configured languages
- Supports adding new languages dynamically

### Caching and Performance
- In-memory caching for fast access
- Prevents duplicate translation requests
- Background processing for non-blocking operation

## Configuration

The i18next configuration in `src/i18n.ts` includes:

```typescript
i18n.init({
  // ... existing configuration
  saveMissing: true,
  missingKeyHandler: (lngs, ns, key, fallbackValue) => {
    // Automatic translation handling
  },
  parseMissingKeyHandler: (key) => {
    // Context extraction
  },
  react: {
    useSuspense: false, // Prevents suspense issues during dynamic loading
  },
});
```

## API Reference

### useAutoTranslation Hook

```typescript
interface UseAutoTranslationReturn {
  t: (key: string, variables?: Record<string, unknown>) => string;
  isLoading: boolean;
  changeLanguage: (language: string) => Promise<void>;
  currentLanguage: string;
  availableLanguages: string[];
  isTranslationPending: (key: string, language?: string) => boolean;
  reloadResources: () => Promise<void>;
}
```

### Translation Manager Methods

- `handleMissingKey(lng, ns, key, fallbackValue)`: Handles missing translation keys
- `parseKeyContext(key)`: Extracts context from translation keys
- `reloadAllResources()`: Reloads all i18next resources
- `initializeI18nextIntegration()`: Initializes the integration with i18next

## Error Handling

The system includes comprehensive error handling:

- Network failures: Automatic retry with exponential backoff
- File system errors: Graceful fallback to cache-only mode
- API errors: Logging and fallback to original text
- Invalid responses: Validation and error recovery

## Testing

To test the integration, use the `TranslationTest` component:

```typescript
import { TranslationTest } from '../components/translation-test';

function App() {
  return (
    <div>
      <TranslationTest />
    </div>
  );
}
```

This component demonstrates:
- Missing key detection and automatic translation
- Language switching
- Variable interpolation
- Real-time translation status