import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

// R-099 (catatan): konteks ini bertipe luas (FieldPath<FieldValues>), sehingga name dari useFormField() tidak
// menyempit ke TName yang dikirim ke <FormField>. Ini pola bawaan shadcn/ui dan tidak menimbulkan bug saat
// runtime; sengaja dibiarkan, dicatat sebagai informasi.
const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  if (!itemContext) {
    throw new Error("useFormField should be used within <FormItem>");
  }

  const fieldState = getFieldState(fieldContext.name, formState);

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
  // R-100: FormDescription/FormMessage mendaftarkan diri saat benar-benar tampil, supaya aria-describedby di
  // FormControl hanya merujuk id elemen yang ada.
  hasDescription: boolean;
  hasMessage: boolean;
  setHasDescription: (value: boolean) => void;
  setHasMessage: (value: boolean) => void;
};

const FormItemContext = React.createContext<FormItemContextValue | null>(null);

const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const id = React.useId();
    const [hasDescription, setHasDescription] = React.useState(false);
    const [hasMessage, setHasMessage] = React.useState(false);
    const value = React.useMemo(
      () => ({ id, hasDescription, hasMessage, setHasDescription, setHasMessage }),
      [id, hasDescription, hasMessage],
    );

    return (
      <FormItemContext.Provider value={value}>
        <div ref={ref} className={cn("space-y-2", className)} {...props} />
      </FormItemContext.Provider>
    );
  },
);
FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField();

  return (
    <Label
      ref={ref}
      className={cn(error && "text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
});
FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  const item = React.useContext(FormItemContext);
  // R-100: hanya id deskripsi/pesan yang memang sedang tampil; bila tidak ada sama sekali, atribut tidak dipasang.
  const describedBy =
    [item?.hasDescription ? formDescriptionId : "", error && item?.hasMessage ? formMessageId : ""]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={describedBy}
      aria-invalid={!!error}
      {...props}
    />
  );
});
FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField();
  const setHasDescription = React.useContext(FormItemContext)?.setHasDescription;
  React.useEffect(() => {
    if (!setHasDescription) return;
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);

  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn("text-[0.8rem] text-muted-foreground", className)}
      {...props}
    />
  );
});
FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField();
  // R-101: "?." setelah error dibuang (error sudah pasti ada di cabang ini). "?? \"\"" tetap dipakai karena
  // FieldError.message di react-hook-form bertipe opsional (message?: Message), jadi bisa undefined.
  const body = error ? String(error.message ?? "") : children;
  const hasBody = Boolean(body);
  const setHasMessage = React.useContext(FormItemContext)?.setHasMessage;
  React.useEffect(() => {
    if (!setHasMessage || !hasBody) return;
    setHasMessage(true);
    return () => setHasMessage(false);
  }, [setHasMessage, hasBody]);

  if (!body) {
    return null;
  }

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn("text-[0.8rem] font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  );
});
FormMessage.displayName = "FormMessage";

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
