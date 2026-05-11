import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Plus, X } from 'lucide-react';

const AddCustomerInline = ({ onAdd, onCancel, initialPhone }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(initialPhone || '');
  const [idProof, setIdProof] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error('Please enter name and phone');
      return;
    }
    setLoading(true);
    try {
      await onAdd({
        name: name.trim(),
        phone: phone.trim(),
        id_proof: idProof.trim(),
        notes: notes.trim(),
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
            <Plus className="w-4 h-4" />
            Add New Customer
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Customer Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full name"
                autoFocus
                data-testid="new-customer-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone Number *</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile"
                type="tel"
                data-testid="new-customer-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>ID Proof</Label>
              <Input
                value={idProof}
                onChange={(e) => setIdProof(e.target.value)}
                placeholder="Aadhaar, PAN, etc."
                data-testid="new-customer-id-proof"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                data-testid="new-customer-notes"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={loading} data-testid="save-new-customer">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add & Select
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default AddCustomerInline;
