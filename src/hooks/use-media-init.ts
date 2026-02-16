import { useEffect, useState } from 'react';
import { fileInitService } from '../services';

interface UseMediaInitResult {
  isInitialized: boolean;
  error: Error | null;
}

export function useMediaInit(): UseMediaInitResult {
  const [state, setState] = useState<UseMediaInitResult>({
    isInitialized: false,
    error: null,
  });

  useEffect(() => {
    async function initialize() {
      try {
        await fileInitService.initializeMediaFolders();
        setState({ isInitialized: true, error: null });
      } catch (error) {
        setState({
          isInitialized: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
        });
        console.error('Failed to initialize media folders:', error);
      }
    }

    initialize();
  }, []);

  return state;
}
