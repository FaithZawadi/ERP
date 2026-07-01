import VerifySearchContent from './VerifySearchContent';
import { getSiteUrl } from '../../lib/seo';

export async function generateMetadata() {
  const siteUrl = await getSiteUrl();
  return {
    title: 'Verify a Certificate | QSL',
    description: 'Verify the authenticity and current status of a Qalibrated Systems Limited calibration certificate.',
    alternates: { canonical: `${siteUrl}/verify` },
  };
}

export default function VerifyPage() {
  return <VerifySearchContent />;
}
