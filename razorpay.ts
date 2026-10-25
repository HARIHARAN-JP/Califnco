
import RazorpayCheckout from "react-native-razorpay";

export interface RazorpayPaymentResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export async function openRazorpayCheckout({
  orderId,
  amountPaise,
  customerName,
  customerEmail,
  customerPhone,
}: {
  orderId: string;
  amountPaise: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
}): Promise<RazorpayPaymentResult> {
  const keyId = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID;

  if (!keyId?.startsWith("rzp_test_")) {
    throw new Error("Please configure your Razorpay test Key ID in .env.");
  }

  if (!orderId || !Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Invalid Razorpay order or payment amount.");
  }

  return RazorpayCheckout.open({
    key: keyId,
    order_id: orderId,
    amount: amountPaise,
    currency: "INR",
    name: "Califnco",
    description: "Water purifier purchase",
    prefill: {
      name: customerName,
      email: customerEmail,
      contact: customerPhone ?? "",
    },
    theme: {
      color: "#167D9A",
    },
  });
}
