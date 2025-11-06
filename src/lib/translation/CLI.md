# Translation CLI Service

The CLI Service provides command-line interface functionality for managing translations in the AI Auto-Translation system.

## Features

### 1. Language Management
- **Add New Languages**: Create new language configurations with automatic translation
- **Language Validation**: Validate language codes and suggest corrections
- **Language Discovery**: Automatically detect available languages

### 2. Translation Operations
- **Batch Translation**: Translate all existing keys to a target language
- **Streaming Progress**: Real-time progress updates during translation operations
- **Progress Tracking**: Monitor translation completion status

### 3. CLI Commands

#### Add Language
```bash
npm run translate add-language <language-code> <language-name>
```
Example:
```bash
npm run translate add-language es "Español"
npm run translate add-language fr "Français"
```

#### Translate All Keys
```bash
npm run translate translate-all <source-language> <target-language>
```
Example:
```bash
npm run translate translate-all en es
npm run translate translate-all en fr
```

#### Show Progress
```bash
npm run translate progress <language-code>
```
Example:
```bash
npm run translate progress es
```

#### List Languages
```bash
npm run translate list
```

#### Show Statistics
```bash
npm run translate stats
```

#### Help
```bash
npm run translate help
```

## API Reference

### CLIService Interface

```typescript
interface CLIService {
  // Core functionality
  addLanguage(languageCode: string, languageName: string): Promise<void>
  translateAllKeys(sourceLanguage: string, targetLanguage: string): AsyncGenerator<TranslationProgress, void, unknown>
  getTranslationProgress(languageCode: string): Promise<LanguageProgress>
  
  // Validation
  validateLanguageCode(code: string): boolean
  validateAndSuggest(code: string): { valid: boolean; suggestions?: string[] }
  
  // Progress display
  showProgress(operation: string, progress: number, details?: string): void
  onProgress(operation: string, callback: (progress: number, details?: string) => void): void
  
  // Utilities
  getCommonLanguages(): Record<string, string>
  getSuggestedLanguageName(code: string): string | null
  displayAvailableLanguages(): void
  displayTranslationStats(): Promise<void>
}
```

### Data Types

```typescript
interface TranslationProgress {
  key: string
  progress: number
}

interface LanguageProgress {
  total: number
  translated: number
  pending: number
}
```

## Usage Examples

### Programmatic Usage

```typescript
import { cliService } from '../lib/translation'

// Add a new language
await cliService.addLanguage('de', 'Deutsch')

// Translate all keys with progress tracking
for await (const progress of cliService.translateAllKeys('en', 'de')) {
  console.log(`Progress: ${progress.progress}% - Key: ${progress.key}`)
}

// Check translation progress
const progress = await cliService.getTranslationProgress('de')
console.log(`${progress.translated}/${progress.total} keys translated`)

// Validate language code
const validation = cliService.validateAndSuggest('invalid-code')
if (!validation.valid) {
  console.log('Suggestions:', validation.suggestions)
}
```

### React Component Integration

```typescript
import { cliService } from '../lib/translation'

function LanguageManager() {
  const [progress, setProgress] = useState(0)
  
  const handleAddLanguage = async () => {
    // Register progress callback
    cliService.onProgress('Adding Language', (progress, details) => {
      setProgress(progress)
    })
    
    await cliService.addLanguage('it', 'Italiano')
    
    // Clean up callback
    cliService.offProgress('Adding Language')
  }
  
  return (
    <div>
      <button onClick={handleAddLanguage}>Add Italian</button>
      <div>Progress: {progress}%</div>
    </div>
  )
}
```

## Configuration

The CLI service uses the following configuration constants:

```typescript
const CLI_CONFIG = {
  PROGRESS_UPDATE_INTERVAL: 100,  // Progress update frequency (ms)
  MAX_CONCURRENT_REQUESTS: 5,     // Max parallel translation requests
  CHUNK_SIZE: 50,                 // Keys processed per batch
}
```

## Error Handling

The CLI service provides comprehensive error handling:

- **Validation Errors**: Invalid language codes, names, or parameters
- **Translation Errors**: AI service failures, network issues
- **File System Errors**: Permission issues, disk space problems
- **Configuration Errors**: Missing API keys, invalid settings

All errors include descriptive messages and suggested solutions.

## Requirements Fulfilled

This implementation fulfills the following requirements:

- **7.1**: CLI commands for adding new languages ✅
- **7.4**: Streaming progress display for translation operations ✅  
- **7.5**: Validation for language codes and names ✅
- **Batch Translation**: Functionality for existing keys ✅

## Integration Points

The CLI service integrates with:

- **Translation Manager**: Core translation orchestration
- **File System Service**: Language directory management
- **AI Translation Service**: Batch translation processing
- **Cache Service**: Progress tracking and state management

## Testing

Test the CLI service using the included test component:

```typescript
import { CLITest } from '../components/cli-test'

// Add to your app for testing
<CLITest />
```

Or use the command line interface directly:

```bash
npm run translate help
```