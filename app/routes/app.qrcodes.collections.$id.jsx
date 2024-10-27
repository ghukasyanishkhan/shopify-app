import { useNavigate, useLoaderData, useSubmit } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, Checkbox } from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { json, redirect } from "@remix-run/node";
import db from "../db.server";

// Fetch all collections and their products (loader)
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`
    #graphql
    query getCollectionsAndProducts {
      collections(first: 250) {
        edges {
          node {
            id
            title
            products(first: 10) {
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
                }
              }
            }
          }
        }
      }
    }`);

  const { data } = await response.json();
  return json({ shop: admin.shop, collections: data.collections.edges });
}

// Action to handle QR code generation
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const formData = await request.formData();
  const selectedCollectionIds = formData.getAll('collectionIds');

  const qrCodePromises = [];

  for (const collectionId of selectedCollectionIds) {
    const products = formData.getAll(`productIds_${collectionId}`);

    for (const productId of products) {
      const productHandle = formData.get(`productHandle_${productId}`);
      const productTitle = formData.get(`productTitle_${productId}`);
      const productVariantId = formData.get(`productVariantId_${productId}`);
      const destination = `https://${shop}/products/${productHandle}`;

      qrCodePromises.push(db.qRCode.create({
        data: {
          productId,
          destination,
          title: productTitle,
          shop,
          productHandle,
          productVariantId,
        },
      }));
    }
  }

  await Promise.all(qrCodePromises);

  return redirect(`/app`);
}

// Remix component for QR Code Generation
export default function QrCodeGeneration() {
  const navigate = useNavigate();
  const { collections } = useLoaderData();
  const [selectedCollections, setSelectedCollections] = useState({});
  const [selectedProducts, setSelectedProducts] = useState({});

  // Handle collection checkbox change
  const handleCollectionCheckboxChange = (id) => {
    setSelectedCollections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
    // Clear selected products for this collection when toggled off
    if (selectedCollections[id]) {
      setSelectedProducts((prev) => ({
        ...prev,
        [id]: {}, // Clear selected products if unchecking the collection
      }));
    }
  };

  // Handle product checkbox change
  const handleProductCheckboxChange = (collectionId, productId) => {
    setSelectedProducts((prev) => ({
      ...prev,
      [collectionId]: {
        ...prev[collectionId],
        [productId]: !prev[collectionId]?.[productId], // Toggle the product selection
      },
    }));
  };

  // Handle submission of selected products
  const submit = useSubmit();

  const handleSubmit = () => {
    const productsFormData = new FormData();
    const selectedCollectionIds = Object.keys(selectedCollections).filter(id => selectedCollections[id]);
    const selectedProductIds = new Set();

    selectedCollectionIds.forEach((collectionId) => {
      const products = selectedProducts[collectionId] || {};
      const productIds = Object.keys(products).filter(productId => products[productId]);

      productIds.forEach((productId) => {
        // Only add unique product IDs to the Set
        selectedProductIds.add(productId);
      });
    });

    // Append selected product data to the FormData
    selectedProductIds.forEach((productId) => {
      const collectionId = selectedCollectionIds.find(id => selectedProducts[id]?.[productId]);
      if (collectionId) {
        const product = collections.find(({ node }) => node.id === collectionId).node.products.edges.find(({ node }) => node.id === productId);
        if (product) {
          const defaultVariant = product.node.variants.edges[0];

          // Ensure that each product is added once
          if (!productsFormData.has(`productIds_${collectionId}`)) {
            productsFormData.append('collectionIds', collectionId);
          }
          productsFormData.append(`productIds_${collectionId}`, productId);
          productsFormData.append(`productHandle_${productId}`, product.node.handle);
          productsFormData.append(`productTitle_${productId}`, product.node.title);
          productsFormData.append(`productVariantId_${productId}`, defaultVariant.node.id);
        }
      }
    });

    if (selectedProductIds.size > 0) {
      submit(productsFormData, { method: "post" });
    } else {
      console.warn("No products selected for QR code generation.");
    }
  };
  return (
    <Page>
      <button style={{ margin: 10 }} variant="breadcrumb" onClick={() => navigate("/app")}>
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

            <Card title="Select Collections">
  <BlockStack gap="500">
    {collections.map(({ node }) => (
      <div key={node.id}>
        <Checkbox
          label={node.title}
          checked={selectedCollections[node.id] || false}
          onChange={() => handleCollectionCheckboxChange(node.id)}
        />
        {selectedCollections[node.id] && (
          <div style={{ paddingLeft: '20px' }}> {/* Optional indentation for clarity */}
            {node.products.edges.map(({ node: product }) => (
              <div key={product.id} style={{ marginBottom: '10px' }}> {/* Space between products */}
                <Checkbox
                  label={product.title}
                  checked={selectedProducts[node.id]?.[product.id] || false}
                  onChange={() => handleProductCheckboxChange(node.id, product.id)}
                />
              </div>
            ))}
          </div>
        )}
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
