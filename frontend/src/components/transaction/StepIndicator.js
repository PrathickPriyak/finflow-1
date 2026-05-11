import React from 'react';
import { Check } from 'lucide-react';

const StepIndicator = ({ currentStep, steps }) => (
  <div className="flex items-center justify-center gap-1 sm:gap-2 px-4 py-3 bg-muted/50 rounded-lg overflow-x-auto">
    {steps.map((step, i) => (
      <React.Fragment key={step.num}>
        <div
          className={`flex items-center gap-1 sm:gap-2 flex-shrink-0 ${
            currentStep >= step.num ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <div
            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-all ${
              currentStep > step.num
                ? 'bg-primary text-primary-foreground'
                : currentStep === step.num
                  ? 'border-2 border-primary bg-primary/10'
                  : 'border-2 border-muted-foreground/30'
            }`}
          >
            {currentStep > step.num ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : step.num}
          </div>
          <span className="hidden lg:block text-xs sm:text-sm font-medium whitespace-nowrap">{step.label}</span>
        </div>
        {i < steps.length - 1 && (
          <div className={`w-4 sm:w-6 lg:w-8 h-0.5 flex-shrink-0 transition-all ${
            currentStep > step.num ? 'bg-primary' : 'bg-muted-foreground/30'
          }`} />
        )}
      </React.Fragment>
    ))}
  </div>
);

export default StepIndicator;
