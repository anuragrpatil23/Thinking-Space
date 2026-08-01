import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

/** `touch` matches the iOS system switch (51×31pt) for finger-driven surfaces;
 *  `default` is the tighter 44×24 one that suits a cursor. Both keep the same
 *  20px thumb travel, so the size change never touches the translate: at
 *  default, 44 − 4 border − 20 thumb = 20; at touch, 51 − 4 − 27 = 20. Change
 *  one of those numbers and you must re-derive the other two. */
type SwitchSizeBlock = 'default' | 'touch'

const SWITCH_ROOT_SIZE_BLOCK: Record<SwitchSizeBlock, string> = {
  default: 'h-6 w-11',
  touch: 'h-[31px] w-[51px]',
}

const SWITCH_THUMB_SIZE_BLOCK: Record<SwitchSizeBlock, string> = {
  default: 'h-5 w-5',
  touch: 'h-[27px] w-[27px]',
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & { size?: SwitchSizeBlock }
>(({ className, size = 'default', ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        "ltm-switch peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        SWITCH_ROOT_SIZE_BLOCK[size],
        className
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "ltm-switch-thumb pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
          SWITCH_THUMB_SIZE_BLOCK[size]
        )}
      />
    </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
