import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { Loader2, Plus, X, CreditCard } from 'lucide-react';

const AddCardInline = ({ onAdd, onCancel, customerName, banks, cardNetworks }) => {
  const [bankId, setBankId] = useState('');
  const [cardNetworkId, setCardNetworkId] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bankId || !cardNetworkId || !lastFour.trim()) {
      toast.error('Please fill all required fields');
      return;
    }
    if (lastFour.length !== 4 || !/^\d+$/.test(lastFour)) {
      toast.error('Please enter exactly 4 digits');
      return;
    }
    setLoading(true);
    try {
      await onAdd({
        bank_id: bankId,
        card_network_id: cardNetworkId,
        last_four_digits: lastFour,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary border-2 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Add New Card for {customerName}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Bank *</Label>
              <SearchableSelect
                value={bankId}
                onValueChange={setBankId}
                placeholder="Search bank..."
                items={(banks || []).map(b => ({ value: b.id, label: b.name }))}
                triggerTestId="new-card-bank-select"
              />
            </div>
            <div className="space-y-2">
              <Label>Card Network *</Label>
              <SearchableSelect
                value={cardNetworkId}
                onValueChange={setCardNetworkId}
                placeholder="Search network..."
                items={(cardNetworks || []).map(n => ({ value: n.id, label: n.name }))}
                triggerTestId="new-card-network-select"
              />
            </div>
            <div className="space-y-2">
              <Label>Last 4 Digits *</Label>
              <Input
                value={lastFour}
                onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                data-testid="new-card-digits"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={loading} data-testid="save-new-card">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add & Select
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default AddCardInline;
