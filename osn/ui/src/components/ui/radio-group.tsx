import { RadioGroup as KobalteRadioGroup } from "@kobalte/core/radio-group";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "../../lib/utils";

type RadioGroupProps = Omit<ComponentProps<"div">, "onChange"> & {
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
};

const RadioGroup: Component<RadioGroupProps> = (props) => {
  const [local, others] = splitProps(props, ["class", "value", "onChange", "name"]);
  return (
    <KobalteRadioGroup
      class={cn("flex gap-2 text-sm", local.class)}
      value={local.value}
      onChange={local.onChange}
      name={local.name}
      {...others}
    />
  );
};

type RadioGroupItemProps = ComponentProps<"div"> & {
  value: string;
  label: string;
};

const RadioGroupItem: Component<RadioGroupItemProps> = (props) => {
  const [local, others] = splitProps(props, ["class", "value", "label"]);
  return (
    <KobalteRadioGroup.Item
      value={local.value}
      class={cn("flex cursor-pointer items-center gap-1", local.class)}
      {...others}
    >
      <KobalteRadioGroup.ItemInput />
      <KobalteRadioGroup.ItemControl class="border-input bg-background data-[checked]:border-primary focus-visible:ring-ring aspect-square h-4 w-4 rounded-full border transition-colors focus-visible:ring-2 focus-visible:outline-none">
        <KobalteRadioGroup.ItemIndicator class="after:bg-primary flex items-center justify-center after:block after:h-2.5 after:w-2.5 after:rounded-full" />
      </KobalteRadioGroup.ItemControl>
      <KobalteRadioGroup.ItemLabel class="text-sm leading-none">
        {local.label}
      </KobalteRadioGroup.ItemLabel>
    </KobalteRadioGroup.Item>
  );
};

export { RadioGroup, RadioGroupItem };
export type { RadioGroupProps, RadioGroupItemProps };
