import { useAlertStore } from '@/stores/alert-store';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

export function GlobalAlert() {
  const { isOpen, config, close } = useAlertStore();

  if (!config) return null;

  const handleConfirm = async () => {
    await config.onConfirm?.();
    close();
  };

  const handleCancel = () => {
    config.onCancel?.();
    close();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <AlertDialogContent
        size="sm"
        className="p-6 bg-card gap-0 after:bg-primary after:h-1 after:w-full after:top-0 after:absolute after:opacity-50 after:blur-lg after:scale-95"
      >
        <AlertDialogHeader className="justify-center">
          <div className="flex flex-col justify-center items-center gap-3 text-center">
            {config.icon}
            <AlertDialogTitle className="text-lg">{config.title}</AlertDialogTitle>
            <AlertDialogDescription>{config.description}</AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        <AlertDialogFooter className="bg-transparent border-t-0">
          <div className="flex flex-col gap-3 w-full mt-2">
            {config.confirmText && (
              <Button
                type="button"
                onClick={handleConfirm}
                variant="default"
                className="py-2 h-auto hover:shadow-[0_4px_20px_var(--primary)]/20 transition-all duration-200 ease-in"
              >
                {config.confirmText}
              </Button>
            )}
            {config.cancelText && (
              <Button
                type="button"
                onClick={handleCancel}
                variant="ghost"
                className="py-2 h-auto hover:bg-primary/5 ease-in-out"
              >
                {config.cancelText}
              </Button>
            )}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
