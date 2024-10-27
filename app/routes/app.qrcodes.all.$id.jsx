import { useNavigate, useLoaderData, useSubmit } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, Checkbox } from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { json, redirect } from "@remix-run/node";
import db from "../db.server";


// Fetch all products (loader)
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
    query getProducts {
      products(first: 250) {
        edges {
          node {
            id
            title
            handle
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                }
              }
            }
            images(first: 1) {
              edges {
                node {
                  originalSrc
                }
              }
            }
          }
        }
      }
    }`
  );

  const { data } = await response.json();
  console.log("Fetched products:", data.products.edges);
  return json({ shop: admin.shop, products: data.products.edges });
}

// Action
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session; // Get shop from session

  // Parse the incoming request data
  const formData = await request.formData();
  const selectedProductIds = formData.getAll('productIds');

  // Iterate over each selected product ID
  const qrCodePromises = selectedProductIds.map(async (productId) => {
    const productHandle = formData.get(`productHandle_${productId}`);
    const productTitle = formData.get(`productTitle_${productId}`);
    const productVariantId = formData.get(`productVariantId_${productId}`);

    // Generate the destination URL based on the product handle
    const destination = `https://${shop}/products/${productHandle}`;

    // Create QR code entry in the database
    await db.qRCode.create({
      data: {
        productId,
        destination,
        title: productTitle,
        shop,
        productHandle,
        productVariantId,
      },
    });
  });

  // Wait for all QR codes to be created
  await Promise.all(qrCodePromises);

  return redirect(`/app`);
}

// Remix component
export default function QrCodeGeneration() {
  const navigate = useNavigate();
  const { products } = useLoaderData();
  const [selectedProducts, setSelectedProducts] = useState({});
  const [selectAll, setSelectAll] = useState(false);

  const handleCheckboxChange = (id) => {
    setSelectedProducts((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSelectAllChange = () => {
    setSelectAll((prev) => !prev);
    const newSelection = {};
    products.forEach(({ node }) => {
      newSelection[node.id] = !selectAll;
    });
    setSelectedProducts(newSelection);
  };

  const submit = useSubmit();
  const handleSubmit = () => {
    const productsFormData = new FormData();

    for (const productId in selectedProducts) {
      if (selectedProducts[productId]) {
        const product = products.find(({ node }) => node.id === productId);
        if (product) {
          const defaultVariant = product.node.variants.edges[0];

          productsFormData.append('productIds', productId);
          productsFormData.append(`productHandle_${productId}`, product.node.handle);
          productsFormData.append(`productTitle_${productId}`, product.node.title);
          productsFormData.append(`productVariantId_${productId}`, defaultVariant.node.id);
        }
      }
    }

    submit(productsFormData, { method: "post" });
  };

  return (
    <Page>
      <button style={{margin: 10}} variant="breadcrub" onClick={() => navigate("/app")}>
          QR codes
        </button>


      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card title="Generate QR Code">
              <BlockStack gap="500">
                <Button primary onClick={handleSubmit}>
                  Generate QR Codes
                </Button>
              </BlockStack>
            </Card>

            <Card title="Select Products">
              <BlockStack gap="500">
                <Button onClick={handleSelectAllChange}>
                  {selectAll ? "Deselect All" : "Select All"}
                </Button>
                <p>Generate your QR code for your products.</p>
                {products.map(({ node }) => (
                  <div key={node.id}>
                    <Checkbox
                      label={node.title}
                      checked={selectedProducts[node.id] || false}
                      onChange={() => handleCheckboxChange(node.id)}
                    />
                  </div>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
