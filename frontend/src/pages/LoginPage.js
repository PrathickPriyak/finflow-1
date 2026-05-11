import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { toast } from 'sonner';
import { Mail, ArrowRight, Loader2, Lock, Eye, EyeOff } from 'lucide-react';
import { getApiError } from '@/lib/formatters';

export default function LoginPage() {
  const { login, verifyOTP } = useAuth();
  const [step, setStep] = useState('credentials'); // 'credentials' or 'otp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    
    if (!email) {
      toast.error('Please enter your email');
      return;
    }
    
    if (!password) {
      toast.error('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const response = await login(email, password);
      // Check if OTP is required (two-factor auth)
      if (response.requires_otp) {
        // Show OTP in toast if available (Preview Mode)
        toast.success(response.message || 'OTP sent to your email');
        setStep('otp');
      } else if (response.token) {
        // Direct login - token returned immediately
        toast.success('Login successful!');
      }
    } catch (error) {
      const message = getApiError(error, 'Invalid email or password');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    
    if (otp.length !== 6) {
      toast.error('Please enter complete OTP');
      return;
    }

    setLoading(true);
    try {
      await verifyOTP(email, otp);
      toast.success('Login successful!');
    } catch (error) {
      toast.error(getApiError(error, 'Invalid OTP'));
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (value) => {
    setOtp(value);
    // Auto-submit when complete
    if (value.length === 6) {
      setTimeout(() => {
        document.getElementById('verify-btn')?.click();
      }, 100);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Background */}
      <div className="hidden lg:flex lg:w-1/2 login-bg relative">
        <div className="absolute inset-0 bg-slate-900/60" />
        <div className="relative z-10 flex flex-col justify-end p-12 text-white">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Fin Flow</h1>
          <p className="text-lg text-white/80 max-w-md">
            Complete business management solution for credit card swiping operations.
          </p>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-md shadow-lg border-0 bg-card">
          <CardHeader className="space-y-1 text-center pb-2">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center justify-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold">FF</span>
              </div>
              <span className="font-bold text-2xl tracking-tight">Fin Flow</span>
            </div>
            
            <CardTitle className="text-2xl font-bold tracking-tight">
              {step === 'credentials' ? 'Welcome back' : 'Two-Factor Authentication'}
            </CardTitle>
            <CardDescription>
              {step === 'credentials' 
                ? 'Enter your credentials to sign in'
                : `Enter the 6-digit code sent to ${email}`
              }
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            {step === 'credentials' ? (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      autoFocus
                      data-testid="email-input"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10"
                      data-testid="password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={loading}
                  data-testid="login-btn"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 mr-2" />
                  )}
                  Continue
                </Button>

                {/* Info about 2FA */}
                <div className="mt-6 p-4 rounded-lg bg-muted/50 border">
                  <p className="text-sm text-muted-foreground">
                    <Lock className="w-4 h-4 inline mr-1" />
                    Two-factor authentication is required. After entering your password, you'll receive an OTP via email.
                  </p>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyOTP} className="space-y-6">
                <div className="space-y-4">
                  <Label className="text-center block">Enter 6-digit code</Label>
                  <div className="flex justify-center" data-testid="otp-container">
                    <InputOTP 
                      maxLength={6} 
                      value={otp} 
                      onChange={handleOtpChange}
                      data-testid="otp-input"
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} data-testid="otp-slot-0" />
                        <InputOTPSlot index={1} data-testid="otp-slot-1" />
                        <InputOTPSlot index={2} data-testid="otp-slot-2" />
                        <InputOTPSlot index={3} data-testid="otp-slot-3" />
                        <InputOTPSlot index={4} data-testid="otp-slot-4" />
                        <InputOTPSlot index={5} data-testid="otp-slot-5" />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </div>

                <Button 
                  id="verify-btn"
                  type="submit" 
                  className={`w-full ${otp.length === 6 ? 'bg-primary hover:bg-primary/90' : ''}`}
                  disabled={loading || otp.length !== 6}
                  data-testid="verify-otp-btn"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  {loading ? 'Verifying...' : 'Verify & Login'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep('credentials');
                    setOtp('');
                    setPassword('');
                  }}
                  data-testid="back-btn"
                >
                  Back to login
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
