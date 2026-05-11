import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Mobile-friendly table wrapper with horizontal scroll
 * Wraps tables to enable horizontal scrolling on mobile devices
 */
const MobileTableWrapper = React.forwardRef(({ className, children, ...props }, ref) => (
  <div 
    ref={ref}
    className={cn(
      "overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0",
      className
    )}
    {...props}
  >
    {children}
  </div>
))
MobileTableWrapper.displayName = "MobileTableWrapper"

export { MobileTableWrapper }
