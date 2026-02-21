import { NextRequest, NextResponse } from 'next/server';

// Demo contract addresses (replace with actual deployed addresses)
const DCLAW_TOKEN_ADDRESS = process.env.DCLAW_TOKEN_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f0AbBe';
const STAKING_CONTRACT_ADDRESS = process.env.STAKING_CONTRACT_ADDRESS || '0x1234567890123456789012345678901234567890';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111'); // Sepolia

// Mock price: 1 ETH = 1000 DCLAW
const ETH_PRICE_USD = 3000;
const DCLAW_PRICE_USD = 0.003; // $0.003 per token
const TOKENS_PER_ETH = ETH_PRICE_USD / DCLAW_PRICE_USD;

/**
 * x402 Payment Protocol Handler
 * 
 * This implements the HTTP 402 (Payment Required) protocol for purchasing DCLAW tokens.
 * Clients can request payment via this endpoint and receive x402-compliant payment headers.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const amount = searchParams.get('amount') || '100';
  const buyer = searchParams.get('buyer');

  // Convert USD amount to tokens
  const tokenAmount = Math.floor(parseFloat(amount) * TOKENS_PER_ETH).toString();
  const ethAmount = (parseFloat(amount) / ETH_PRICE_USD).toString();

  // Check if this is an x402 payment request
  const acceptX402 = request.headers.get('Accept')?.includes('application/x402') || 
                      request.headers.get('Accept')?.includes('402');

  if (acceptX402 || buyer) {
    // Return x402 payment information
    // HTTP 402 "Payment Required" response with WWW-Authenticate header
    const paymentResponse = {
      version: '1.0',
      scheme: 'erc20',
      description: 'DCLAW Token Purchase via x402 Protocol',
      mechanism: 'swap',
      address: DCLAW_TOKEN_ADDRESS,
      chainId: CHAIN_ID,
      currency: 'ETH',
      amount: ethAmount,
      token: {
        address: DCLAW_TOKEN_ADDRESS,
        amount: tokenAmount,
        symbol: 'DCLAW',
        decimals: 18,
      },
      conditions: {
        minAmount: '0.001',
        maxAmount: '100',
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      },
      instructions: [
        '1. Send exact ETH amount to the contract',
        '2. Contract will send DCLAW tokens to your address',
        '3. Alternatively, use Biconomy smart account for gasless transactions',
      ],
    };

    return NextResponse.json(paymentResponse, {
      status: 200,
      headers: {
        'WWW-Authenticate': `x402 scheme="erc20" chain="${CHAIN_ID}" contract="${DCLAW_TOKEN_ADDRESS}"`,
        'X-Payment-Required': ethAmount + ' ETH',
        'X-Token-Amount': tokenAmount + ' DCLAW',
      },
    });
  }

  // Return regular purchase info
  return NextResponse.json({
    success: true,
    token: 'DCLAW',
    amount: tokenAmount,
    price: ethAmount,
    currency: 'ETH',
    chainId: CHAIN_ID,
    contract: DCLAW_TOKEN_ADDRESS,
  });
}

/**
 * Handle POST requests for executing purchases
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, buyer, paymentMethod, txHash } = body;

    if (!buyer || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: buyer, amount' },
        { status: 400 }
      );
    }

    // Calculate token amount
    const tokenAmount = Math.floor(parseFloat(amount) * TOKENS_PER_ETH).toString();

    // In production, you would:
    // 1. Verify the payment on-chain
    // 2. Check if txHash was provided and confirmed
    // 3. Distribute tokens via merkle tree or direct mint

    // For demo, return success
    return NextResponse.json({
      success: true,
      message: 'Purchase queued',
      buyer,
      tokenAmount,
      txHash: txHash || '0x' + '0'.repeat(64),
      status: 'pending',
      estimatedDelivery: '2-5 minutes',
    });
  } catch (error) {
    console.error('Payment error:', error);
    return NextResponse.json(
      { error: 'Payment processing failed' },
      { status: 500 }
    );
  }
}
