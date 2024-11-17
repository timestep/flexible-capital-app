import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import OpenAI from 'openai';

import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Link,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const {
  OPENAI_BASEURL = '', 
  OPENAI_MODEL = ''
} = process.env;

const PROMPT = `You are a professional e-commerce copywriter specializing in SEO-optimized product descriptions. Write a compelling product description for a [Product Name] based on the following details:

Product Details:
- Primary Function: [Main use/purpose]
- Key Features: [List 3-4 main features]
- Target Audience: [Ideal customer]
- Price Point: [Price range]
- Main Keywords: [2-3 target keywords]

Requirements:
- Write 100-150 words
- Include primary keyword naturally in the first sentence
- Focus on benefits, not just features
- Use persuasive but authentic language
- Include a clear call-to-action
- Optimize for readability with short paragraphs
- Do not use superlatives like "best" or "ultimate"
- Do not include placeholder text or meta commentary
- Return only the final description

Example Input:
Product Name: Bamboo Bath Towel Set
Primary Function: Luxury bathroom towels
Key Features: Quick-drying, antibacterial, ultra-soft
Target Audience: Eco-conscious homeowners
Price Point: Premium ($50-75)
Main Keywords: "bamboo bath towels", "sustainable bathroom accessories"

Expected Output Style:
Transform your daily routine with our premium bamboo bath towel set, crafted for the eco-conscious homeowner. These ultra-soft towels combine luxury with sustainability, featuring natural antibacterial properties that keep your towels fresh between uses. The quick-drying bamboo fibers ensure your towels are ready for your next shower, while their generous size provides full-body comfort.

Perfect for modern bathrooms, these towels maintain their softness wash after wash while reducing your environmental impact. Each set includes two bath towels, two hand towels, and two washcloths, all designed to bring spa-like comfort to your home. Experience the perfect balance of luxury and sustainability – add these bamboo towels to your cart today.
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

// Define types for the GraphQL response
interface ProductVariant {
  id: string;
  price: string;
  barcode: string;
  createdAt: string;
}

interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  description: string;
  variants: {
    edges: Array<{
      node: ProductVariant;
    }>;
  };
}

interface ProductsQueryResponse {
  data: {
    products: {
      edges: Array<{
        node: Product;
      }>;
    };
  };
}

interface ProductUpdateResponse {
  data: {
    productUpdate: {
      product: {
        id: string;
        description: string;
      };
      userErrors: Array<{
        field: string[];
        message: string;
      }>;
    };
  };
}

const LLMClient = new OpenAI({
  baseURL: OPENAI_BASEURL,
  apiKey: 'sk-1234',
});


async function generateLLMDescription(title: string): Promise<string> {

  const adjectives = [
    'premium', 'high-quality', 'elegant', 'innovative', 'versatile',
    'durable', 'stylish', 'modern', 'classic', 'exceptional'
  ];
  
  const benefits = [
    'perfect for everyday use',
    'designed to last',
    'brings comfort to your life',
    'enhances your lifestyle',
    'exceeds expectations',
    'sets new standards',
    'delivers outstanding performance',
    'brings joy to your daily routine'
  ];
  
  const features = [
    'carefully crafted',
    'made with premium materials',
    'thoughtfully designed',
    'precision-engineered',
    'expertly manufactured'
  ];

  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomBenefit = benefits[Math.floor(Math.random() * benefits.length)];
  const randomFeature = features[Math.floor(Math.random() * features.length)];

  const description = `This ${randomAdjective} ${title} is ${randomBenefit}. It is ${randomFeature}.`;

  const chat = await LLMClient.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'system',
        content: PROMPT,
      },
      { role: 'user', content: "Write a product description following this format for: " + description },
    ],
  });

  console.log(chat.choices[0].message.content + '\n');

  return chat.choices[0].message.content ?? '';
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // First, fetch products
  const productsList = await admin.graphql(
    `#graphql
    query {
      products(first: 10) {
        edges {
          node {
            id
            title
            description
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }
    }`
  );

  const productsListJson = (await productsList.json()) as ProductsQueryResponse;
  const products = productsListJson.data.products.edges;

  console.log(`Fetched ${products.length} products`);
  // Update each product with a random description
  const updatedProducts = await Promise.all(
    products.map(async ({ node: product }) => {
      const newDescription = await generateLLMDescription(product.title);
      
      const updateResponse = await admin.graphql(
        `#graphql
        mutation ($input: ProductUpdateInput!) {
          productUpdate(product: $input) {
            product {
              descriptionHtml
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              id: product.id,
              descriptionHtml: newDescription,
            },
          },
        }
      );

      const updateJson = await updateResponse.json() as ProductUpdateResponse;
      
      if (updateJson.data.productUpdate.userErrors.length > 0) {
        throw new Error(`Failed to update product ${product.title}: ${updateJson.data.productUpdate.userErrors[0].message}`);
      }
      
      return updateJson.data.productUpdate.product;
    })
  );

  return json({
    products: updatedProducts,
    message: `Successfully updated ${updatedProducts.length} products with new descriptions`
  });
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const generateProduct = () => {
    console.log('Generating product');  
    return fetcher.submit({}, { method: "POST" })
  };

  return (
    <Page>
      <TitleBar title="Remix app template">
        <button variant="primary" onClick={generateProduct}>
          Generate a product
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Congrats on creating a new Shopify app 🎉
                  </Text>
                  <Text variant="bodyMd" as="p">
                    This embedded app template uses{" "}
                    <Link
                      url="https://shopify.dev/docs/apps/tools/app-bridge"
                      target="_blank"
                      removeUnderline
                    >
                      App Bridge
                    </Link>{" "}
                    interface examples like an{" "}
                    <Link url="/app/additional" removeUnderline>
                      additional page in the app nav
                    </Link>
                    , as well as an{" "}
                    <Link
                      url="https://shopify.dev/docs/api/admin-graphql"
                      target="_blank"
                      removeUnderline
                    >
                      Admin GraphQL
                    </Link>{" "}
                    mutation demo, to provide a starting point for app
                    development.
                  </Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Get started with products
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Generate a product with GraphQL and get the JSON output for
                    that product. Learn more about the{" "}
                    <Link
                      url="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
                      target="_blank"
                      removeUnderline
                    >
                      productCreate
                    </Link>{" "}
                    mutation in our API references.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button loading={isLoading} onClick={generateProduct}>
                    Generate a product
                  </Button>
                  
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
